function requireAuth(req, res, next) {
  if (!req.session?.steamid) {
    return res.status(401).json({ error: 'not-authenticated' });
  }
  next();
}

module.exports = requireAuth;
