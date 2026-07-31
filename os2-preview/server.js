const express = require('express');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;
const publicDir = path.join(__dirname, '..', 'public', 'os2');

app.disable('x-powered-by');
app.use(express.static(publicDir, {
  etag: true,
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0
}));

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    application: 'Talk2Me OS2 Preview',
    environment: process.env.NODE_ENV || 'development',
    time: new Date().toISOString()
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(port, () => {
  console.log(`Talk2Me OS2 preview running on port ${port}`);
});
