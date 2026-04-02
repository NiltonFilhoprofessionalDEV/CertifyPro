module.exports = {
  MAX_CERTIFICATES: 300,
  BATCH_SIZE: 50,
  UPLOAD_DIR: require('path').join(__dirname, '..', 'uploads'),
  PORT: process.env.PORT || 3000,
};
