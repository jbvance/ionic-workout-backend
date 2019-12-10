const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
require('dotenv').config({ path: 'variables.env' });
const createServer = require('./createServer');
const db = require('./db');

const server = createServer();

// TODO: LOCKDOWN PRISMA SERVER TO PREVENT ACCESS OUTSIDE APP

server.express.use(cookieParser());
// decode JWT so we can get user id on each request
server.use((req, res, next) => {
  const { token } = req.cookies;  
  if (token) {
    const { userId } = jwt.verify(token, process.env.APP_SECRET);
    req.userId = userId;
  }
  next();
});

//create middleware that populates the user on each request
server.use(async (req, res, next) => {
  // skip if not logged in
  if (!req.userId) return next();
  const user = await db.query.user(
    {
      where: { id: req.userId }
    },
    '{ id, permissions, email, name}'
  );
  req.user = user;
  next();
});

server.start(
  {
    cors: {
      credentials: true,
      origin: process.env.FRONTEND_URL
    }
  },
  deets => {
    console.log(`Server is now running on port http:/localhost:${deets.port}`);
  }
);
