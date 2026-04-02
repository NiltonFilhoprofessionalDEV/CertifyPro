module.exports = {
  MAX_CERTIFICATES: 300,
  BATCH_SIZE: 50,
  // Em produção (Render), pode apontar para disco persistente: /var/data/uploads
  UPLOAD_DIR: process.env.UPLOAD_DIR || require('path').join(__dirname, '..', 'uploads'),
  PORT: process.env.PORT || 3000,
};
