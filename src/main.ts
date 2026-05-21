import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, orderBy, onSnapshot, addDoc, updateDoc, deleteDoc, doc, runTransaction, arrayUnion, arrayRemove, getDoc, setDoc, getDocs, collectionGroup } from 'firebase/firestore';
import { getAuth, onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut, User, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendEmailVerification, updateProfile } from 'firebase/auth';
import { firebaseConfig } from './firebaseConfig';


// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

// Interfaces
interface UserData {
    campus: string;
}

interface SnackData {
    name: string;
    votes: number;
    upvotedUsers: string[];
    downvotedUsers: string[];
}

// State
let currentUser: User | null = null;
let currentCampus: string = "";
let isModerator: boolean = false;
let unsubscribeSnacks: (() => void) | null = null;
let unsubscribeUser: (() => void) | null = null;

// DOM Elements
const userProfileEl = document.getElementById('user-profile')!;
const snacksListEl = document.getElementById('snacks-list')!;
const proposeSectionEl = document.getElementById('propose-section')!;
const snackNameInput = document.getElementById('snack-name-input') as HTMLInputElement;
const proposeBtn = document.getElementById('propose-btn')!;
const proposeErrorEl = document.getElementById('propose-error')!;

// Tab Listeners
const tabCampus = document.getElementById('tab-campus')!;
const tabGlobal = document.getElementById('tab-global')!;

if (tabCampus && tabGlobal) {
    tabCampus.addEventListener('click', () => {
        tabCampus.classList.add('active');
        tabCampus.classList.remove('secondary');
        tabGlobal.classList.add('secondary');
        tabGlobal.classList.remove('active');
        const mainSectionTitle = document.getElementById('main-section-title')!;
        if (mainSectionTitle) {
            mainSectionTitle.textContent = "Ranked Snacks";
        }
        if (currentCampus) {
            loadSnacks(currentCampus);
        }
    });

    tabGlobal.addEventListener('click', () => {
        tabGlobal.classList.add('active');
        tabGlobal.classList.remove('secondary');
        tabCampus.classList.add('secondary');
        tabCampus.classList.remove('active');
        loadGlobalLeaderboard();
    });
}

// Auth Listener
onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    if (user) {
        console.log("User signed in:", user.uid);
        
        // Show tabs
        tabCampus.classList.remove('hidden');
        tabGlobal.classList.remove('hidden');

        // Handle verify complete callback
        if (window.location.pathname === '/verify-complete') {
            console.log("Reached verify-complete path. Refreshing token...");
            await user.getIdToken(true);
            window.history.replaceState({}, document.title, '/');
        }

        // Check custom claims for moderator status
        const idTokenResult = await user.getIdTokenResult();
        isModerator = idTokenResult.claims.isModerator === true;

        // Fetch or create user doc
        const userDocRef = doc(db, 'users', user.uid);
        const userDocSnap = await getDoc(userDocRef);

        let campus = "";
        if (!userDocSnap.exists()) {
            await setDoc(userDocRef, {
                campus: ""
            });
        } else {
            const data = userDocSnap.data() as UserData;
            campus = data.campus || "";
            currentCampus = campus;
        }

        updateUserProfileUI(user, isModerator);

        // Listen for claims updates and request moderation if eligible
        const isGoogleUser = user.email && user.email.endsWith('@google.com');
        if (isGoogleUser && !isModerator) {
            if (user.emailVerified) {
                console.log("User is eligible for moderator. Requesting claims...");
                await setDoc(doc(db, 'needModUsers', user.uid), {});
            }

            if (unsubscribeUser) unsubscribeUser();
            unsubscribeUser = onSnapshot(userDocRef, async (snapshot) => {
                const data = snapshot.data();
                if (data && data.claimsUpdated) {
                    console.log("Claims updated detected, refreshing token...");
                    await user.getIdToken(true);
                    const idTokenResult = await user.getIdTokenResult();
                    isModerator = idTokenResult.claims.isModerator === true;

                    if (isModerator && unsubscribeUser) {
                        console.log("User is now a moderator. Unsubscribing.");
                        unsubscribeUser();
                    }

                    updateUserProfileUI(user, isModerator);
                    await loadCampuses(currentCampus);
                }
            });
        } else if (unsubscribeUser) {
            unsubscribeUser();
        }

        // Load campuses and populate dropdown
        await loadCampuses(campus);

        // Show propose section if email is verified AND campus is selected
        updateProposeSectionVisibility(user);

        if (campus) {
            loadSnacks(campus);
        } else {
            snacksListEl.innerHTML = '<p style="color: var(--text-secondary);">Please select a campus to view snacks.</p>';
        }
    } else {
        console.log("User signed out");
        currentUser = null;
        currentCampus = "";
        isModerator = false;
        updateUserProfileUI(null, false);
        proposeSectionEl.classList.add('hidden');
        
        // Hide tabs
        tabCampus.classList.add('hidden');
        tabGlobal.classList.add('hidden');
        
        snacksListEl.innerHTML = '<p style="color: var(--text-secondary);">Please login to see snacks.</p>';
        if (unsubscribeSnacks) unsubscribeSnacks();
        if (unsubscribeUser) unsubscribeUser();
    }
});

function updateProposeSectionVisibility(user: User) {
    if (user.emailVerified && currentCampus) {
        proposeSectionEl.classList.remove('hidden');
    } else {
        proposeSectionEl.classList.add('hidden');
    }
}

// UI Updates
function updateUserProfileUI(user: User | null, isMod: boolean) {
    if (user) {
        userProfileEl.innerHTML = `
            <div class="user-info">
                <span class="user-name">
                    ${user.displayName || user.email} 
                    ${isMod ? '<span class="moderator-badge">Mod</span>' : ''}
                    ${user.emailVerified ? '<span class="verified-badge">Verified</span>' : ''}
                </span>
                <div style="margin-top: 0.5rem; display: flex; align-items: center; gap: 0.5rem;">
                    <span id="current-campus-display">Campus: ${currentCampus || 'None'}</span>
                    <button id="change-campus-btn" class="secondary" style="padding: 0.25rem 0.5rem; font-size: 0.8rem;">Change</button>
                    ${!user.emailVerified ? '<button id="verify-email-btn" class="secondary" style="padding: 0.25rem 0.5rem; font-size: 0.8rem;">Verify Email</button>' : ''}
                </div>
            </div>
            <button id="logout-btn" class="secondary">Logout</button>
        `;
        document.getElementById('logout-btn')!.addEventListener('click', () => signOut(auth));

        document.getElementById('change-campus-btn')!.addEventListener('click', () => {
            showCampusModal();
        });

        if (!user.emailVerified) {
            document.getElementById('verify-email-btn')!.addEventListener('click', () => {
                sendVerificationLink();
            });
        }
    } else {
        userProfileEl.innerHTML = `<button id="open-login-modal-btn">Login</button>`;
        document.getElementById('open-login-modal-btn')!.addEventListener('click', () => {
            showLoginModal();
        });
    }
}

async function showCampusModal() {
    const campusesCol = collection(db, 'campuses');
    const snapshot = await getDocs(campusesCol);

    const modalOverlay = document.createElement('div');
    modalOverlay.className = 'modal-overlay';

    let optionsHtml = '';
    snapshot.forEach((doc) => {
        const data = doc.data();
        optionsHtml += `
            <div class="campus-option ${doc.id === currentCampus ? 'selected' : ''}" onclick="selectCampusFromModal('${doc.id}')">
                ${data.code}
            </div>
        `;
    });

    modalOverlay.innerHTML = `
        <div class="modal-content">
            <div class="modal-title">Select Campus</div>
            <div class="campus-options">
                ${optionsHtml}
            </div>
            <div class="modal-warning">
                ⚠️ Changing the campus will remove existing votes.
            </div>
            <button class="secondary" onclick="closeModal()">Close</button>
        </div>
    `;

    document.body.appendChild(modalOverlay);

    window.selectCampusFromModal = async (newCampus: string) => {
        if (newCampus !== currentCampus) {
            currentCampus = newCampus;
            updateProposeSectionVisibility(currentUser!);

            // Update user doc
            await updateDoc(doc(db, 'users', currentUser!.uid), {
                campus: newCampus
            });

            // Update display
            document.getElementById('current-campus-display')!.textContent = `Campus: ${newCampus}`;

            if (newCampus) {
                loadSnacks(newCampus);
            } else {
                snacksListEl.innerHTML = '<p style="color: var(--text-secondary);">Please select a campus to view snacks.</p>';
                if (unsubscribeSnacks) unsubscribeSnacks();
            }
        }
        window.closeModal();
    };

    window.closeModal = () => {
        document.body.removeChild(modalOverlay);
    };
}

function showLoginModal() {
    const modalOverlay = document.createElement('div');
    modalOverlay.className = 'modal-overlay';

    modalOverlay.innerHTML = `
        <div class="modal-content" style="max-width: 400px;">
            <div class="modal-title">Sign In</div>
            <div class="auth-form" style="display: flex; flex-direction: column; gap: 1rem;">
                <button id="login-btn" style="width: 100%;">Sign in with Google</button>
                <div style="text-align: center; color: var(--text-secondary);">or</div>
                <div id="name-input-container" style="display: flex; flex-direction: column; gap: 0.5rem;" class="hidden">
                    <label for="name-input" style="font-size: 0.9rem; color: var(--text-secondary);">Name</label>
                    <input type="text" id="name-input" placeholder="Your Name" style="padding: 0.75rem; border-radius: 10px; border: 1px solid var(--glass-border); background: rgba(15, 23, 42, 0.8); color: white;">
                </div>
                <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                    <label for="email-input" style="font-size: 0.9rem; color: var(--text-secondary);">Email</label>
                    <input type="email" id="email-input" placeholder="your.email@example.com" style="padding: 0.75rem; border-radius: 10px; border: 1px solid var(--glass-border); background: rgba(15, 23, 42, 0.8); color: white;">
                </div>
                <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                    <label for="password-input" style="font-size: 0.9rem; color: var(--text-secondary);">Password</label>
                    <input type="password" id="password-input" placeholder="••••••••" style="padding: 0.75rem; border-radius: 10px; border: 1px solid var(--glass-border); background: rgba(15, 23, 42, 0.8); color: white;">
                </div>
                <button id="email-submit-btn" style="width: 100%;">Sign In</button>
                <p id="auth-error" style="color: var(--danger); font-size: 0.8rem; margin: 0;" class="hidden"></p>
                <div style="text-align: center; font-size: 0.9rem; color: var(--text-secondary); margin-top: 0.5rem;">
                    New to MicroKitchen? <a href="#" id="toggle-auth-mode-btn" style="color: var(--accent-primary); text-decoration: none;">Create new account</a>
                </div>
            </div>
            <button class="secondary" id="close-login-modal-btn" style="margin-top: 1rem;">Close</button>
        </div>
    `;

    document.body.appendChild(modalOverlay);

    let isSignUpMode = false;

    const nameInputContainer = modalOverlay.querySelector('#name-input-container') as HTMLDivElement;
    const nameInput = modalOverlay.querySelector('#name-input') as HTMLInputElement;
    const emailInput = modalOverlay.querySelector('#email-input') as HTMLInputElement;
    const passwordInput = modalOverlay.querySelector('#password-input') as HTMLInputElement;
    const submitBtn = modalOverlay.querySelector('#email-submit-btn') as HTMLButtonElement;
    const toggleBtn = modalOverlay.querySelector('#toggle-auth-mode-btn') as HTMLAnchorElement;
    const titleEl = modalOverlay.querySelector('.modal-title') as HTMLDivElement;
    const errorEl = modalOverlay.querySelector('#auth-error') as HTMLParagraphElement;

    modalOverlay.querySelector('#login-btn')!.addEventListener('click', () => {
        signInWithPopup(auth, provider);
        document.body.removeChild(modalOverlay);
    });

    submitBtn.addEventListener('click', async () => {
        const email = emailInput.value.trim();
        const password = passwordInput.value;
        const name = nameInput.value.trim();

        if (!email || !password) {
            showModalError("Please enter both email and password.");
            return;
        }

        if (isSignUpMode && !name) {
            showModalError("Please enter your name.");
            return;
        }

        try {
            if (isSignUpMode) {
                const userCredential = await createUserWithEmailAndPassword(auth, email, password);
                await updateProfile(userCredential.user, { displayName: name });
                console.log("User created and profile updated with name:", name);
            } else {
                await signInWithEmailAndPassword(auth, email, password);
            }
            document.body.removeChild(modalOverlay);
        } catch (e: any) {
            console.error("Auth error:", e);
            showModalError(e.message);
        }
    });

    toggleBtn.addEventListener('click', (e) => {
        e.preventDefault();
        isSignUpMode = !isSignUpMode;
        if (isSignUpMode) {
            titleEl.textContent = "Create Account";
            submitBtn.textContent = "Sign Up";
            toggleBtn.textContent = "Already have an account? Sign In";
            nameInputContainer.classList.remove('hidden');
        } else {
            titleEl.textContent = "Sign In";
            submitBtn.textContent = "Sign In";
            toggleBtn.textContent = "New to MicroKitchen? Create new account";
            nameInputContainer.classList.add('hidden');
        }
        errorEl.classList.add('hidden');
    });

    modalOverlay.querySelector('#close-login-modal-btn')!.addEventListener('click', () => {
        document.body.removeChild(modalOverlay);
    });

    function showModalError(msg: string) {
        errorEl.textContent = msg;
        errorEl.classList.remove('hidden');
    }
}

async function sendVerificationLink() {
    if (!currentUser) return;

    const actionCodeSettings = {
        url: window.location.origin + '/verify-complete',
        handleCodeInApp: true
    };

    try {
        await sendEmailVerification(currentUser, actionCodeSettings);
        alert("Verification email sent! Please check your inbox.");
    } catch (error: any) {
        console.error("Error sending verification email:", error);
        alert("Failed to send verification email: " + error.message);
    }
}

// Load Campuses
async function loadCampuses(selectedCampus: string) {
    const campusesCol = collection(db, 'campuses');
    let snapshot = await getDocs(campusesCol);

    if (snapshot.empty) {
        console.log("No campuses found, populating defaults...");
        await populateDefaultCampuses();
        snapshot = await getDocs(campusesCol);
    }

    const campusSelect = document.getElementById('campus-select') as HTMLSelectElement;
    if (!campusSelect) return;

    campusSelect.innerHTML = '<option value="">Select Campus</option>';
    snapshot.forEach((doc) => {
        console.log("Campus doc:", doc.id);
        const data = doc.data();
        const option = document.createElement('option');
        option.value = doc.id; // Using doc ID as code
        option.textContent = data.code;
        if (doc.id === selectedCampus) {
            option.selected = true;
        }
        campusSelect.appendChild(option);
    });
}

async function populateDefaultCampuses() {
    const campusesCol = collection(db, 'campuses');
    const defaults = ['MTV', 'NYC', 'SFO', 'SVL', 'WAT'];
    for (const code of defaults) {
        // Using code as document ID
        await setDoc(doc(campusesCol, code), {
            code: code
        });
    }
}

// Load Snacks in Real-time for a specific campus
function loadSnacks(campusId: string) {
    if (unsubscribeSnacks) unsubscribeSnacks();

    const snacksQuery = query(collection(db, 'campuses', campusId, 'snacks'), orderBy('votes', 'desc'));

    unsubscribeSnacks = onSnapshot(snacksQuery, (snapshot) => {
        if (snapshot.empty) {
            snacksListEl.innerHTML = '<p style="color: var(--text-secondary);">No snacks proposed for this campus yet.</p>';
            populateDefaultSnacksIfEmpty(campusId);
            return;
        }

        let html = '';
        snapshot.forEach((doc) => {
            const snack = doc.data() as SnackData;
            const snackId = doc.id;
            const isUpvoted = currentUser ? snack.upvotedUsers?.includes(currentUser.uid) : false;
            const isDownvoted = currentUser ? snack.downvotedUsers?.includes(currentUser.uid) : false;

            html += `
                <div class="snack-card">
                    <div class="snack-info">
                        <div class="snack-name">${snack.name}</div>
                        <div class="snack-votes">${snack.votes} votes</div>
                        ${isModerator ? `
                            <div class="moderator-controls">
                                <button class="danger" onclick="deleteSnack('${snackId}')">Delete</button>
                            </div>
                        ` : ''}
                    </div>
                    <div class="vote-controls">
                        <button class="vote-btn ${isUpvoted ? 'upvoted' : ''}" onclick="handleVote('${snackId}', 'upvote')">
                            ▲
                        </button>
                        <div class="score">${snack.votes}</div>
                        <button class="vote-btn ${isDownvoted ? 'downvoted' : ''}" onclick="handleVote('${snackId}', 'downvote')">
                            ▼
                        </button>
                    </div>
                </div>
            `;
        });
        snacksListEl.innerHTML = html;
    }, (error) => {
        console.error("Error loading snacks:", error);
        snacksListEl.innerHTML = '<p style="color: var(--danger);">Error loading snacks. Check console.</p>';
    });
}

// Populate Default Snacks
async function populateDefaultSnacksIfEmpty(campusId: string) {
    const snacksCol = collection(db, 'campuses', campusId, 'snacks');
    const defaults = ['La Croix', 'Granoogle', 'Banana'];
    console.log(`Populating default snacks for ${campusId}...`);
    for (const name of defaults) {
        await addDoc(snacksCol, {
            name: name,
            votes: 0,
            upvotedUsers: [],
            downvotedUsers: []
        });
    }
}

async function loadGlobalLeaderboard() {
    if (unsubscribeSnacks) unsubscribeSnacks();

    const mainSectionTitle = document.getElementById('main-section-title')!;
    if (mainSectionTitle) {
        mainSectionTitle.textContent = "Global Leaderboard";
    }

    snacksListEl.innerHTML = '<p style="color: var(--text-secondary);">Loading global leaderboard...</p>';

    const snacksQuery = collectionGroup(db, 'snacks');

    unsubscribeSnacks = onSnapshot(snacksQuery, (snapshot) => {
        const snackMap = new Map<string, { votes: number }>();

        snapshot.forEach((doc) => {
            const snack = doc.data() as SnackData;
            const name = snack.name;

            if (!snackMap.has(name)) {
                snackMap.set(name, { votes: 0 });
            }

            const current = snackMap.get(name)!;
            current.votes += snack.votes;
        });

        const sortedSnacks = Array.from(snackMap.entries()).map(([name, data]) => ({
            name,
            votes: data.votes
        })).sort((a, b) => b.votes - a.votes);

        if (sortedSnacks.length === 0) {
            snacksListEl.innerHTML = '<p style="color: var(--text-secondary);">No snacks found.</p>';
            return;
        }

        let html = '';
        sortedSnacks.forEach((snack, index) => {
            html += `
                <div class="snack-card">
                    <div class="snack-info">
                        <div class="snack-name">${snack.name}</div>
                        <div class="snack-votes">${snack.votes} votes total</div>
                    </div>
                    <div class="rank" style="font-size: 1.5rem; font-weight: 600; color: var(--accent-primary);">#${index + 1}</div>
                </div>
            `;
        });
        snacksListEl.innerHTML = html;
    }, (error) => {
        console.error("Error loading global leaderboard:", error);
        snacksListEl.innerHTML = '<p style="color: var(--danger);">Error loading leaderboard. Check console.</p>';
    });
}

// Expose functions to window
declare global {
    interface Window {
        handleVote: (snackId: string, type: string) => Promise<void>;
        deleteSnack: (snackId: string) => Promise<void>;
        selectCampusFromModal: (newCampus: string) => Promise<void>;
        closeModal: () => void;
    }
}

window.handleVote = async (snackId: string, type: string) => {
    if (!currentUser || !currentCampus) return;

    const snackRef = doc(db, 'campuses', currentCampus, 'snacks', snackId);
    const uid = currentUser.uid;

    try {
        await runTransaction(db, async (transaction) => {
            const snackDoc = await transaction.get(snackRef);
            if (!snackDoc.exists()) {
                throw "Snack does not exist!";
            }

            const data = snackDoc.data() as SnackData;
            const upvotedUsers = data.upvotedUsers || [];
            const downvotedUsers = data.downvotedUsers || [];
            let votes = data.votes || 0;

            const isUpvoted = upvotedUsers.includes(uid);
            const isDownvoted = downvotedUsers.includes(uid);

            if (type === 'upvote') {
                if (isUpvoted) {
                    transaction.update(snackRef, {
                        upvotedUsers: arrayRemove(uid),
                        votes: votes - 1
                    });
                } else if (isDownvoted) {
                    transaction.update(snackRef, {
                        downvotedUsers: arrayRemove(uid),
                        upvotedUsers: arrayUnion(uid),
                        votes: votes + 2
                    });
                } else {
                    transaction.update(snackRef, {
                        upvotedUsers: arrayUnion(uid),
                        votes: votes + 1
                    });
                }
            } else if (type === 'downvote') {
                if (isDownvoted) {
                    transaction.update(snackRef, {
                        downvotedUsers: arrayRemove(uid),
                        votes: votes + 1
                    });
                } else if (isUpvoted) {
                    transaction.update(snackRef, {
                        upvotedUsers: arrayRemove(uid),
                        downvotedUsers: arrayUnion(uid),
                        votes: votes - 2
                    });
                } else {
                    transaction.update(snackRef, {
                        downvotedUsers: arrayUnion(uid),
                        votes: votes - 1
                    });
                }
            }
        });
    } catch (e) {
        console.error("Vote transaction failed: ", e);
    }
};

proposeBtn.addEventListener('click', async () => {
    const name = snackNameInput.value.trim();
    if (!name || !currentCampus) return;

    if (!currentUser || !currentUser.emailVerified) {
        showProposeError("You must have a verified email to propose snacks.");
        return;
    }

    try {
        await addDoc(collection(db, 'campuses', currentCampus, 'snacks'), {
            name: name,
            votes: 0,
            upvotedUsers: [],
            downvotedUsers: []
        });
        snackNameInput.value = '';
        proposeErrorEl.classList.add('hidden');
    } catch (e) {
        console.error("Error proposing snack:", e);
        showProposeError("Failed to propose snack. Check rules.");
    }
});

function showProposeError(msg: string) {
    proposeErrorEl.textContent = msg;
    proposeErrorEl.classList.remove('hidden');
}

window.deleteSnack = async (snackId: string) => {
    if (!isModerator || !currentCampus) return;
    if (confirm("Are you sure you want to delete this snack?")) {
        try {
            await deleteDoc(doc(db, 'campuses', currentCampus, 'snacks', snackId));
        } catch (e) {
            console.error("Error deleting snack:", e);
        }
    }
};




