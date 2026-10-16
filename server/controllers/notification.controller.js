const {
    Announcements,
    Notifications,
    Users,
    Registrations,
    Events,
    col
} = require('../models/db');
const {
    successResponse,
    errorResponse
} = require('../utils/apiResponse');
const {
    paginationMeta
} = require('../utils/pagination');

// ─── Task 2.1 ─────────────────────────────────────────────────────────────────

const createAnnouncement = async (req, res, next) => {
    try {
        const {
            title,
            message
        } = req.body;
        // Accept both 'audience' (frontend) and 'audienceType' (legacy)
        const audienceType = req.body.audienceType || req.body.audience || 'all_students';
        const eventId = req.body.eventId || null;

        // Validate title
        if (!title || title.trim().length < 1 || title.trim().length > 100) {
            return errorResponse(res, 'Title must be 1–100 characters', 422);
        }

        // Validate message
        if (!message || message.trim().length < 1 || message.trim().length > 1000) {
            return errorResponse(res, 'Message must be 1–1000 characters', 422);
        }

        // Require eventId for event_registrants audience
        if (audienceType === 'event_registrants' && !eventId) {
            return errorResponse(res, 'Event is required for event_registrants audience', 422);
        }

        // Resolve recipients
        let recipientIds = [];
        let eventTitle = null;

        if (audienceType === 'event_registrants') {
            const event = await Events.findById(eventId);
            if (!event) return errorResponse(res, 'Event not found', 404);
            eventTitle = event.title;
            const registrations = await Registrations.findByEvent(eventId);
            recipientIds = registrations.map((r) => r.student);
        } else {
            // all_students — fetch entire users collection, filter by role in memory
            const snap = await col('users').get();
            const allUsers = snap.docs.map((d) => ({
                _id: d.id,
                ...d.data()
            }));
            recipientIds = allUsers.filter((u) => u.role === 'student').map((u) => u._id);
        }

        // Create announcement first
        const adminUser = await Users.findById(req.user._id);
        const announcement = await Announcements.create({
            senderId: req.user._id,
            senderName: adminUser ? adminUser.name : 'Admin',
            title: title.trim(),
            message: message.trim(),
            audienceType,
            audience: audienceType,
            eventId: eventId || null,
            eventTitle: eventTitle || null,
            recipientCount: recipientIds.length,
        });

        // Batch-create notifications with the real announcementId
        const notificationsWithId = recipientIds.map((recipientId) => ({
            announcementId: announcement._id,
            recipientId,
            senderId: req.user._id,
            title: title.trim(),
            message: message.trim(),
            audienceType,
            eventId: eventId || null,
        }));

        if (notificationsWithId.length > 0) {
            await Notifications.createBatch(notificationsWithId);
        }

        return successResponse(res, {
            announcement,
            recipientCount: recipientIds.length
        }, 'Announcement sent successfully', 201);
    } catch (err) {
        next(err);
    }
};

// ─── Task 2.5 ─────────────────────────────────────────────────────────────────

const getMyAnnouncements = async (req, res, next) => {
    try {
        // Fetch all announcements, filter by senderId in memory — avoids Firestore index
        const snap = await col('announcements').get();
        const all = snap.docs
            .map((d) => ({
                _id: d.id,
                ...d.data()
            }))
            .filter((a) => a.senderId === req.user._id)
            .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

        return successResponse(res, {
            announcements: all,
            total: all.length
        }, 'Announcements fetched');
    } catch (err) {
        next(err);
    }
};

const getAllAnnouncements = async (req, res, next) => {
    try {
        const {
            announcements,
            total
        } = await Announcements.findAll({
            limit: 200,
            offset: 0
        });
        return successResponse(res, {
            announcements,
            total
        }, 'All announcements fetched');
    } catch (err) {
        next(err);
    }
};

const deleteAnnouncement = async (req, res, next) => {
    try {
        const {
            id
        } = req.params;
        const announcement = await Announcements.findById(id);

        if (!announcement) return errorResponse(res, 'Announcement not found', 404);

        if (announcement.senderId !== req.user._id) {
            return errorResponse(res, 'Forbidden: not the owner', 403);
        }

        await Notifications.deleteByAnnouncement(id);
        await Announcements.delete(id);

        return successResponse(res, null, 'Announcement deleted');
    } catch (err) {
        next(err);
    }
};

// ─── Task 2.8 ─────────────────────────────────────────────────────────────────

const getMyNotifications = async (req, res, next) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = 20;
        const offset = (page - 1) * limit;
        const {
            notifications,
            total
        } = await Notifications.findByRecipient(req.user._id, {
            limit,
            offset
        });
        return successResponse(res, {
            notifications,
            meta: paginationMeta(total, page, limit)
        }, 'Notifications fetched');
    } catch (err) {
        next(err);
    }
};

const getUnreadCount = async (req, res, next) => {
    try {
        const count = await Notifications.countUnread(req.user._id);
        return successResponse(res, {
            count,
            unreadCount: count
        }, 'Unread count fetched');
    } catch (err) {
        next(err);
    }
};

const markAsRead = async (req, res, next) => {
    try {
        const {
            id
        } = req.params;
        const {
            col
        } = require('../models/db');

        const doc = await col('notifications').doc(id).get();
        if (!doc.exists) return errorResponse(res, 'Notification not found', 404);

        const notification = {
            _id: doc.id,
            ...doc.data()
        };
        if (notification.recipientId !== req.user._id) {
            return errorResponse(res, 'Forbidden', 403);
        }

        const updated = await Notifications.markRead(id);
        return successResponse(res, {
            notification: updated
        }, 'Notification marked as read');
    } catch (err) {
        next(err);
    }
};

const markAllAsRead = async (req, res, next) => {
    try {
        await Notifications.markAllRead(req.user._id);
        return successResponse(res, null, 'All notifications marked as read');
    } catch (err) {
        next(err);
    }
};

module.exports = {
    createAnnouncement,
    getMyAnnouncements,
    getAllAnnouncements,
    deleteAnnouncement,
    getMyNotifications,
    getUnreadCount,
    markAsRead,
    markAllAsRead,
};