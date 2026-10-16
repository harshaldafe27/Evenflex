const express = require('express');
const {
    protect
} = require('../middleware/auth.middleware');
const {
    authorize
} = require('../middleware/rbac.middleware');
const {
    createAnnouncement,
    getMyAnnouncements,
    getAllAnnouncements,
    deleteAnnouncement,
    getMyNotifications,
    getUnreadCount,
    markAsRead,
    markAllAsRead,
} = require('../controllers/notification.controller');

const router = express.Router();

// Announcement routes
router.post('/announcements', protect, authorize('admin'), createAnnouncement);
router.get('/announcements/mine', protect, authorize('admin', 'principal'), getMyAnnouncements);
router.get('/announcements/all', protect, authorize('principal'), getAllAnnouncements);
router.delete('/announcements/:id', protect, authorize('admin'), deleteAnnouncement);

// Notification routes — static paths MUST come before /:id param routes
router.get('/unread-count', protect, getUnreadCount);
router.patch('/read-all', protect, markAllAsRead);
router.get('/', protect, getMyNotifications);
// Allow any authenticated user to mark their own notification as read
router.patch('/:id/read', protect, markAsRead);

module.exports = router;