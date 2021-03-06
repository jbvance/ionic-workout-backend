const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { randomBytes } = require('crypto');
const { promisify } = require('util');
const { transport, makeANiceEmail } = require('../mail');
const { hasPermission } = require('../utils');
const stripe = require('../stripe');

const Mutations = {
  async createExercise(parent, args, ctx, info) {
    if (!ctx.request.userId)
      throw new Error('You must be logged in to create an exercise');
    const exercise = await ctx.db.mutation.createExercise(
      {
        data: {
          // Create a relationship between item and user
          user: {
            connect: {
              id: ctx.request.userId
            }
          },
          ...args
        }
      },
      info
    );

    return exercise;
  },
  updateExercise(parent, args, ctx, info) {
    // first take a copy of the updated
    const updates = { ...args };
    // remove ID from updates because you can't update it
    delete updates.id;
    return ctx.db.mutation.updateExercise(
      {
        data: updates,
        where: { id: args.id }
      },
      info
    );
  },

  async deleteExercise(parent, args, ctx, info) {
    const where = { id: args.id };
    const exercise = await ctx.db.query.exercise({ where }, `{ id title user { id } }`);
    const ownsItem = item.user.id === ctx.request.userId;
    const hasPermissions = ctx.request.user.permissions.some(permission =>
      ['ADMIN', 'ITEMDELETE'].includes(permission)
    );
    if (!ownsItem || !hasPermissions) {
      throw new Error("You don't have permission to delete this item");
    }
    return ctx.db.mutation.deleteExercise({ where }, info);
  },

  async signup(parent, args, ctx, info) {
    args.email = args.email.toLowerCase();
    // hash the password
    const password = await bcrypt.hash(args.password, 10);
    const user = await ctx.db.mutation.createUser(
      {
        data: {
          ...args,
          password,
          permissions: { set: ['USER'] }
        }
      },
      info
    );
    //create jwt for user
    const token = jwt.sign({ userId: user.id }, process.env.APP_SECRET);
    //set jwt as cookie on response
    ctx.response.cookie('token', token, {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 365
    }); // 1 year cookieParser
    //return user to browser
    return user;
  },

  async signin(parent, { email, password }, ctx, info) {
    const user = await ctx.db.query.user({ where: { email } });
    if (!user) {
      throw new Error(`No such user found for email ${email}`);
    }
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) throw new Error('Invalid Password');
    const token = jwt.sign({ userId: user.id }, process.env.APP_SECRET);
    ctx.response.cookie('token', token, {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 365
    });
    console.log('TOKEN', token);
    return user;
  },
  signout(parent, args, ctx, info) {
    ctx.response.clearCookie('token');
    return { message: 'Goodbye!' };
  },
  async requestReset(parent, { email }, ctx, info) {
    const user = await ctx.db.query.user({ where: { email } });
    if (!user) throw new Error(`No such user found for email ${email}`);
    const randomBytesPromisified = promisify(randomBytes);
    const resetToken = (await randomBytesPromisified(20)).toString('hex');
    const resetTokenExpiry = Date.now() + 3600000; // 1 hour from now
    const res = await ctx.db.mutation.updateUser({
      where: { email },
      data: { resetToken, resetTokenExpiry }
    });
    const mailRes = await transport.sendMail({
      from: 'jbvance@gmail.com',
      to: user.email,
      subject: 'Password Reset',
      html: makeANiceEmail(
        `Your password reset token is here! \n\n <a href="${process.env.FRONTEND_URL}/reset?resetToken=${resetToken}">Click here to reset your password</a>`
      )
    });
    return { message: 'Thanks!' };
  },
  async resetPassword(parent, args, ctx, info) {
    if (args.password !== args.confirmPassword)
      throw new Error('Your passwords do not match');
    const [user] = await ctx.db.query.users({
      where: {
        resetToken: args.resetToken,
        resetTokenExpiry_gte: Date.now() - 3600000
      }
    });
    if (!user) throw new Error('This token is either invalid or expired');
    const password = await bcrypt.hash(args.password, 10);
    const updatedUser = await ctx.db.mutation.updateUser({
      where: { email: user.email },
      data: { password, resetToken: null, resetTokenExpiry: null }
    });
    const token = jwt.sign({ userId: updatedUser.id }, process.env.APP_SECRET);
    ctx.response.cookie('token', token, {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 365
    });
    return updatedUser;
  },
  async updatePermissions(parent, args, ctx, info) {
    // check if logged in
    if (!ctx.request.userId) throw new Error('You must be logged in!');
    // query current user
    const currentUser = await ctx.db.query.user(
      { where: { id: ctx.request.userId } },
      info
    );
    // check permission to udpate permissions
    hasPermission(currentUser, ['ADMIN', 'PERMISSIONUPDATE']);
    // update permissions
    return ctx.db.mutation.updateUser(
      {
        data: {
          permissions: {
            set: args.permissions
          }
        },
        where: {
          id: args.userId
        }
      },
      info
    );
  },  
};

module.exports = Mutations;
