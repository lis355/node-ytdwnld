FROM node:current-alpine

RUN apk add --no-cache ffmpeg

WORKDIR /app
COPY package.json ./
RUN npm install --only=production
COPY . .

CMD ["node", "start.js", "bot"]
