const jwt = require('jsonwebtoken');
const {
    JWT_ACCESS_SECRET
} = require('../config/env');
const {
    errorResponse
} = require('../utils/apiResponse');
const {
    Users
} = require('../models/db');

const protect = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return errorResponse(res, 'No token provided', 401);
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_ACCESS_SECRET);

        // Always fetch fresh user from Firestore so role is always current
        const user = await Users.findById(decoded._id);
        if (!user) {
            return errorResponse(res, 'User not found', 401);
        }
        // isActive defaults to true if not explicitly set to false
        if (user.isActive === false) {
            return errorResponse(res, 'Account is inactive', 401);
        }

        // Use Firestore role as source of truth, not JWT payload
        req.user = {
            ...decoded,
            role: user.role,
            _id: user._id
        };
        next();
    } catch (err) {
        return errorResponse(res, 'Invalid or expired token', 401);
    }
};

module.exports = {
    protect
};