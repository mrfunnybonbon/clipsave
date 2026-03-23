FROM node:22-bookworm

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates ffmpeg python3 python3-pip unzip \
  && rm -rf /var/lib/apt/lists/*

RUN pip3 install --no-cache-dir --break-system-packages --upgrade yt-dlp

RUN curl -fsSL https://deno.land/install.sh | sh
ENV PATH="/root/.deno/bin:${PATH}"

COPY package*.json ./
RUN npm install

COPY . .

ENV PORT=10000
EXPOSE 10000

CMD ["node", "server.js"]
