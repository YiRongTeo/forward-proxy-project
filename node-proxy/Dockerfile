FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

ENV PROXY_PORT=8080
ENV ADMIN_PORT=3001

EXPOSE 8080 3001

CMD ["node", "src/index.js"]
