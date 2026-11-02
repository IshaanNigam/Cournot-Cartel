FROM node:20-alpine

USER 1000

WORKDIR /app

COPY --chown=1000:1000 package*.json ./

RUN npm install --omit=dev

COPY --chown=1000:1000 . .


ENV PORT=7860
EXPOSE 7860

CMD ["npm", "start"]