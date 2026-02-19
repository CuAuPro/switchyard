const express = require('express');

const app = express();
const port = Number(process.env.APP_PORT ?? process.env.PORT ?? 4000);
const version = process.env.APP_VERSION || 'v1.0.0';
const color = process.env.APP_COLOR || 'blue';

app.get('/', (_req, res) => {
  res.json({ version, color });
});

app.get('/healthz', (_req, res) => {
  res.json({ status: 'ok', version, color });
});

app.listen(port, () => {
  console.log(`Sample app ${color} running on port ${port}`);
});
