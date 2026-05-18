import { setGlobalOptions } from "firebase-functions";
import { onDocumentUpdated, onDocumentCreated } from "firebase-functions/firestore";
import * as admin from "firebase-admin";

admin.initializeApp();
const db = admin.firestore();

setGlobalOptions({ maxInstances: 10 });

exports.onUserCampusChange = onDocumentUpdated("users/{userId}", async (event) => {
    if (!event.data) {
        console.log("No data associated with this event.");
        return;
    }

    const beforeData = event.data.before.data();
    const afterData = event.data.after.data();
    const uid = event.params.userId;

    const oldCampus = beforeData.campus;
    const newCampus = afterData.campus;

    // Check if campus field changed and was not empty before
    if (oldCampus && oldCampus !== newCampus) {
        console.log(`User ${uid} changed campus from ${oldCampus} to ${newCampus}. Clearing old votes.`);

        const snacksCol = db.collection('campuses').doc(oldCampus).collection('snacks');

        // Find snacks upvoted by user
        const upvotedQuery = snacksCol.where('upvotedUsers', 'array-contains', uid);
        const upvotedSnap = await upvotedQuery.get();

        const batch = db.batch();

        upvotedSnap.forEach(doc => {
            batch.update(doc.ref, {
                upvotedUsers: admin.firestore.FieldValue.arrayRemove(uid),
                votes: admin.firestore.FieldValue.increment(-1)
            });
        });

        // Find snacks downvoted by user
        const downvotedQuery = snacksCol.where('downvotedUsers', 'array-contains', uid);
        const downvotedSnap = await downvotedQuery.get();

        downvotedSnap.forEach(doc => {
            batch.update(doc.ref, {
                downvotedUsers: admin.firestore.FieldValue.arrayRemove(uid),
                votes: admin.firestore.FieldValue.increment(1)
            });
        });

        await batch.commit();
        console.log(`Cleared votes for user ${uid} in campus ${oldCampus}`);
    }
});

exports.grantModerator = onDocumentCreated("users/{userId}", async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;
    
    const uid = event.params.userId;
    
    try {
        const userRecord = await admin.auth().getUser(uid);
        const email = userRecord.email;
        const emailVerified = userRecord.emailVerified;
        
        if (email && email.endsWith('@google.com') && emailVerified) {
            console.log(`User ${uid} meets criteria. Granting moderator claim.`);
            await admin.auth().setCustomUserClaims(uid, { isModerator: true });
            
            // Trigger client refresh by updating the doc
            await snapshot.ref.update({
                claimsUpdated: admin.firestore.FieldValue.serverTimestamp()
            });
        }
    } catch (error) {
        console.error("Error granting moderator claim:", error);
    }
});
