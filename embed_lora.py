"""
Embed a single query with the LoRA Nomic model and print JSON to stdout.
"""

import argparse
import json
import sys
from pathlib import Path

import torch
import torch.nn.functional as F
from peft import PeftModel
from transformers import AutoModel, AutoTokenizer

ROOT_DIR = Path(__file__).resolve().parent
TRAINED_ROOT = ROOT_DIR / "models"
DEFAULT_MODEL = "epoch_11_75k_data"
BASE_MODEL_FALLBACK = "nomic-embed-text"
MAX_LENGTH = 256


def load_base_model_name(lora_dir: Path) -> str:
    config_path = lora_dir / "adapter_config.json"
    if not config_path.exists():
        return BASE_MODEL_FALLBACK
    with config_path.open("r", encoding="utf-8") as handle:
        config = json.load(handle)
    base_name = config.get("base_model_name_or_path") or config.get("base_model_name")
    return str(base_name or BASE_MODEL_FALLBACK)


def load_lora_model(lora_dir: Path):
    if not lora_dir.exists():
        raise FileNotFoundError(f"Missing LoRA directory: {lora_dir}")

    base_name = load_base_model_name(lora_dir)
    tokenizer = AutoTokenizer.from_pretrained(lora_dir, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token or tokenizer.unk_token

    base_model = AutoModel.from_pretrained(base_name, trust_remote_code=True)
    if (
        getattr(base_model.config, "pad_token_id", None) is None
        and tokenizer.pad_token_id is not None
    ):
        base_model.config.pad_token_id = tokenizer.pad_token_id

    model = PeftModel.from_pretrained(base_model, lora_dir)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model.to(device)
    model.eval()
    return tokenizer, model, device


def mean_pooling(last_hidden_state: torch.Tensor, attention_mask: torch.Tensor) -> torch.Tensor:
    mask = attention_mask.unsqueeze(-1).expand(last_hidden_state.size()).float()
    summed = (last_hidden_state * mask).sum(dim=1)
    counts = mask.sum(dim=1).clamp(min=1e-9)
    return summed / counts


def get_forward_model(model: torch.nn.Module) -> torch.nn.Module:
    if hasattr(model, "base_model"):
        base_model = model.base_model
        if hasattr(base_model, "model"):
            return base_model.model
        return base_model
    return model


def encode(model: torch.nn.Module, batch: dict) -> torch.Tensor:
    forward_model = get_forward_model(model)
    inputs = {
        key: value
        for key, value in batch.items()
        if key in {"input_ids", "attention_mask", "token_type_ids", "position_ids"}
    }
    outputs = forward_model(**inputs)
    if hasattr(outputs, "last_hidden_state"):
        token_embeddings = outputs.last_hidden_state
    else:
        token_embeddings = outputs[0]
    attention_mask = inputs.get("attention_mask")
    if attention_mask is None:
        attention_mask = torch.ones_like(inputs["input_ids"])
    return mean_pooling(token_embeddings, attention_mask)


def embed_text(text: str, tokenizer: AutoTokenizer, model: torch.nn.Module, device: torch.device) -> list:
    batch = tokenizer(
        [text],
        padding=True,
        truncation=True,
        max_length=MAX_LENGTH,
        return_tensors="pt",
    )
    batch = {key: value.to(device) for key, value in batch.items()}
    with torch.inference_mode():
        emb = encode(model, batch)
        emb = F.normalize(emb, p=2, dim=1)
    return emb[0].cpu().tolist()


def resolve_lora_dir(model_name: str) -> Path:
    cleaned = model_name.strip()
    if not cleaned:
        cleaned = DEFAULT_MODEL
    if Path(cleaned).name != cleaned or cleaned in {".", ".."}:
        raise ValueError("Invalid model name.")
    lora_dir = TRAINED_ROOT / cleaned
    if not lora_dir.exists():
        raise FileNotFoundError(f"Missing LoRA directory: {lora_dir}")
    return lora_dir


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Embed a query with LoRA Nomic.")
    parser.add_argument("--text", default="", help="Query text.")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="LoRA model folder name.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    text = args.text.strip()
    if not text:
        text = sys.stdin.read().strip()
    if not text:
        raise ValueError("Missing input text.")

    lora_dir = resolve_lora_dir(args.model)
    tokenizer, model, device = load_lora_model(lora_dir)
    embedding = embed_text(text, tokenizer, model, device)
    payload = {"embedding": embedding}
    print(json.dumps(payload, ensure_ascii=True))


if __name__ == "__main__":
    main()
