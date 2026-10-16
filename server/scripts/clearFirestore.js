/**
 * One-time script to delete ALL documents from all Firestore collections.
 * Run with: node scripts/clearFirestore.js
 */
require('../config/env'); // loads dotenv
const {
    initFirebase
} = require('../config/firebase');

const COLLECTIONS = [
    'users',
    'events',
    'registrations',
    'notifications',
    'announcements',
    'approvalRequests',
    'auditLogs',
];

const deleteCollection = async (db, collectionName) => {
    const ref = db.collection(collectionName);
    const snap = await ref.get();
    if (snap.empty) {
        console.log(`  ${collectionName}: empty, skipping`);
        return 0;
    }
    // Firestore batch limit is 500
    const chunks = [];
    for (let i = 0; i < snap.docs.length; i += 499) {
        chunks.push(snap.docs.slice(i, i + 499));
    }
    for (const chunk of chunks) {
        const batch = db.batch();
        chunk.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
    }
    console.log(`  ${collectionName}: deleted ${snap.docs.length} documents`);
    return snap.docs.length;
};

const main = async () => {
    const db = initFirebase();
    console.log('\nClearing Firestore...\n');
    let total = 0;
    for (const col of COLLECTIONS) {
        total += await deleteCollection(db, col);
    }
    console.log(`\nDone. Total deleted: ${total} documents.`);
    process.exit(0);
};

main().catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
});