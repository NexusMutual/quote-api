function wrap (text, length) {
  const regex = new RegExp(`.{1,${length}}`, 'g');
  return text.match(regex);
}

module.exports = {
  wrap,
};
