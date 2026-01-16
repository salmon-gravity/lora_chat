FROM node:20-bookworm

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 \
        python3-dev \
        python3-pip \
        python3-venv \
        build-essential \
        libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/requirements.txt
RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir --upgrade pip \
    && /opt/venv/bin/pip install --no-cache-dir -r /app/requirements.txt

COPY .env /app/.env

COPY chat_project/package*.json /app/chat_project/
WORKDIR /app/chat_project
RUN npm install --omit=dev

COPY chat_project/ /app/chat_project/

ENV VIRTUAL_ENV=/opt/venv
ENV PATH="/opt/venv/bin:$PATH"
ENV PORT=5050
ENV PYTHON_BIN=/opt/venv/bin/python

EXPOSE 5050

CMD ["npm", "start"]
