const QRCode = require('qrcode');
const {
    v4: uuidv4
} = require('uuid');
const {
    Users,
    Events,
    Registrations,
    col
} = require('../models/db');
const {
    successResponse,
    errorResponse
} = require('../utils/apiResponse');
const {
    getIO
} = require('../sockets/index');

/**
 * Generate a real QR code for a confirmed registration.
 * GET /api/v1/qr/generate/:registrationId
 */
const generateQR = async (req, res) => {
    try {
        const reg = await Registrations.findById(req.params.registrationId);
        if (!reg) return errorResponse(res, 'Registration not found', 404);
        if (reg.student !== req.user._id) return errorResponse(res, 'Forbidden', 403);
        if (!['confirmed', 'active'].includes(reg.status)) {
            return errorResponse(res, 'Registration is not confirmed', 400);
        }

        // Generate or reuse qrToken
        let qrToken = reg.qrToken;
        if (!qrToken) {
            qrToken = uuidv4();
            await Registrations.update(reg._id, {
                qrToken,
                qrStatus: 'ACTIVE'
            });
        }

        const payload = JSON.stringify({
            userId: reg.student,
            eventId: reg.event,
            token: qrToken,
        });

        const qrDataUrl = await QRCode.toDataURL(payload, {
            errorCorrectionLevel: 'H',
            margin: 3,
            width: 512,
            color: {
                dark: '#000000',
                light: '#ffffff'
            },
        });

        return successResponse(res, {
            qrDataUrl,
            qrToken
        }, 'QR generated');
    } catch (err) {
        return errorResponse(res, err.message, 500);
    }
};

/**
 * Validate a scanned QR code and mark entry.
 * POST /api/v1/qr/scan
 * Handles both formats:
 *   - { userId, eventId, token }  — server-generated QR
 *   - { registrationId, specialId } — client-side fallback QR
 */
const scanQR = async (req, res) => {
    try {
        const {
            qrData
        } = req.body;
        if (!qrData) return errorResponse(res, 'QR data is required', 400);

        let payload;
        try {
            payload = typeof qrData === 'string' ? JSON.parse(qrData) : qrData;
        } catch {
            return errorResponse(res, 'Invalid QR format', 422);
        }

        // ── Format 1: server-generated QR { userId, eventId, token } ──────────
        if (payload.userId && payload.eventId && payload.token) {
            return await validateServerQR(payload, res);
        }

        // ── Format 2: client fallback QR { registrationId, specialId } ─────────
        if (payload.registrationId || payload.specialId) {
            return await validateFallbackQR(payload, res);
        }

        return errorResponse(res, 'Invalid QR: unrecognized format', 422);
    } catch (err) {
        return errorResponse(res, err.message, 500);
    }
};

async function validateServerQR({
    userId,
    eventId,
    token
}, res) {
    const user = await Users.findById(userId);
    if (!user) return errorResponse(res, 'Invalid Pass: user not found', 422);

    const event = await Events.findById(eventId);
    if (!event) return errorResponse(res, 'Invalid Pass: event not found', 422);

    const reg = await Registrations.findDuplicate(userId, eventId);
    if (!reg || reg.status !== 'confirmed') {
        return errorResponse(res, 'Invalid Pass: not registered for this event', 422);
    }

    if (reg.qrToken !== token) {
        return errorResponse(res, 'Invalid Pass: token mismatch', 422);
    }

    return await markAndRespond(reg, user, event, res);
}

async function validateFallbackQR({
    registrationId,
    specialId
}, res) {
    let reg = registrationId ? await Registrations.findById(registrationId) : null;

    if (!reg && specialId) {
        const snap = await col('registrations').where('specialId', '==', specialId).limit(1).get();
        if (!snap.empty) reg = {
            _id: snap.docs[0].id,
            ...snap.docs[0].data()
        };
    }

    if (!reg || reg.status !== 'confirmed') {
        return errorResponse(res, 'Invalid Pass: registration not found or not confirmed', 422);
    }

    const user = await Users.findById(reg.student);
    if (!user) return errorResponse(res, 'Invalid Pass: user not found', 422);

    const event = await Events.findById(reg.event);
    if (!event) return errorResponse(res, 'Invalid Pass: event not found', 422);

    return await markAndRespond(reg, user, event, res);
}

async function markAndRespond(reg, user, event, res) {
    if (reg.qrStatus === 'USED') {
        return successResponse(res, {
            status: 'ALREADY_USED',
            message: 'Already Entered',
            entryTime: reg.entryTime,
            student: {
                name: user.name,
                email: user.email
            },
            event: {
                title: event.title
            },
        }, 'Already Entered');
    }

    const entryTime = new Date().toISOString();
    await Registrations.update(reg._id, {
        qrStatus: 'USED',
        entryTime
    });

    try {
        const io = getIO();
        if (io) {
            const entryLog = {
                name: user.name,
                email: user.email,
                eventTitle: event.title,
                entryTime,
                registrationId: reg._id
            };
            io.to('admin-' + event.createdBy).emit('entry:scanned', entryLog);
            io.to('principal-room').emit('entry:scanned', entryLog);
        }
    } catch (_) {}

    return successResponse(res, {
        status: 'VALID',
        message: 'Entry Allowed',
        student: {
            name: user.name,
            email: user.email
        },
        event: {
            title: event.title
        },
        entryTime,
    }, 'Entry Allowed');
}

const getEntryStats = async (req, res) => {
    try {
        const event = await Events.findById(req.params.eventId);
        if (!event) return errorResponse(res, 'Event not found', 404);
        if (event.createdBy !== req.user._id) return errorResponse(res, 'Forbidden', 403);
        const regs = await Registrations.findByEvent(req.params.eventId);
        const confirmed = regs.filter((r) => r.status === 'confirmed');
        const entered = confirmed.filter((r) => r.qrStatus === 'USED');
        return successResponse(res, {
            totalRegistrations: confirmed.length,
            totalEntries: entered.length,
            remainingEntries: confirmed.length - entered.length,
        }, 'Entry stats fetched');
    } catch (err) {
        return errorResponse(res, err.message, 500);
    }
};

const getEntryLogs = async (req, res) => {
    try {
        const snap = await col('registrations').get();
        const regs = snap.docs.map((d) => ({
            _id: d.id,
            ...d.data()
        })).filter((r) => r.qrStatus === 'USED');
        regs.sort((a, b) => (b.entryTime || '').localeCompare(a.entryTime || ''));
        const populated = await Promise.all(regs.slice(0, 100).map(async (r) => {
            const [user, event] = await Promise.all([Users.findById(r.student), Events.findById(r.event)]);
            return {
                registrationId: r._id,
                name: (user && user.name) || 'Unknown',
                email: (user && user.email) || 'Unknown',
                eventTitle: (event && event.title) || 'Unknown',
                entryTime: r.entryTime
            };
        }));
        return successResponse(res, {
            logs: populated
        }, 'Entry logs fetched');
    } catch (err) {
        return errorResponse(res, err.message, 500);
    }
};

const getPlatformEntryStats = async (req, res) => {
    try {
        const snap = await col('registrations').get();
        const all = snap.docs.map((d) => d.data());
        const totalRegistrations = all.filter((r) => r.status === 'confirmed').length;
        const totalEntries = all.filter((r) => r.qrStatus === 'USED').length;
        return successResponse(res, {
            totalRegistrations,
            totalEntries,
            remainingEntries: Math.max(0, totalRegistrations - totalEntries)
        }, 'Platform entry stats fetched');
    } catch (err) {
        return errorResponse(res, err.message, 500);
    }
};

module.exports = {
    generateQR,
    scanQR,
    getEntryStats,
    getEntryLogs,
    getPlatformEntryStats
};