FROM node:22-bookworm

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip \
  && rm -rf /var/lib/apt/lists/*

RUN pip3 install --break-system-packages yt-dlp

COPY package*.json ./
RUN npm install

COPY . .

ENV PORT=10000
EXPOSE 10000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:10000/api/health || exit 1

CMD ["npm", "start"]
