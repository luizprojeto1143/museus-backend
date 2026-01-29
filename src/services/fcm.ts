import * as admin from 'firebase-admin';

// Initialize Firebase Admin (only once)
let firebaseApp: admin.app.App | null = null;

const initializeFirebase = (): admin.app.App => {
    if (firebaseApp) {
        return firebaseApp;
    }

    // Check if we have the service account JSON in env
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

    if (serviceAccountJson) {
        try {
            const serviceAccount = JSON.parse(serviceAccountJson);
            firebaseApp = admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
            });
        } catch (error) {
            console.error('Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON:', error);
            throw new Error('Invalid Firebase service account configuration');
        }
    } else {
        // Fallback: try to use default credentials (for local dev with gcloud auth)
        try {
            firebaseApp = admin.initializeApp({
                credential: admin.credential.applicationDefault(),
            });
        } catch (error) {
            console.warn('Firebase not configured. Push notifications will be disabled.');
            throw new Error('Firebase not configured');
        }
    }

    return firebaseApp;
};

export interface PushNotificationPayload {
    title: string;
    body: string;
    imageUrl?: string;
    data?: Record<string, string>;
}

/**
 * Send push notification to a single device
 */
export const sendPushNotification = async (
    token: string,
    payload: PushNotificationPayload
): Promise<boolean> => {
    try {
        const app = initializeFirebase();
        const messaging = app.messaging();

        const message: admin.messaging.Message = {
            token,
            notification: {
                title: payload.title,
                body: payload.body,
                imageUrl: payload.imageUrl,
            },
            data: payload.data,
            webpush: {
                notification: {
                    icon: '/pwa-192x192.png',
                    badge: '/pwa-192x192.png',
                    vibrate: [200, 100, 200],
                },
                fcmOptions: {
                    link: payload.data?.url || '/',
                },
            },
        };

        const response = await messaging.send(message);
        console.log('Push notification sent:', response);
        return true;
    } catch (error) {
        console.error('Failed to send push notification:', error);
        return false;
    }
};

/**
 * Send push notification to multiple devices
 */
export const sendPushNotificationToMany = async (
    tokens: string[],
    payload: PushNotificationPayload
): Promise<{ success: number; failure: number }> => {
    if (tokens.length === 0) {
        return { success: 0, failure: 0 };
    }

    try {
        const app = initializeFirebase();
        const messaging = app.messaging();

        const message: admin.messaging.MulticastMessage = {
            tokens,
            notification: {
                title: payload.title,
                body: payload.body,
                imageUrl: payload.imageUrl,
            },
            data: payload.data,
            webpush: {
                notification: {
                    icon: '/pwa-192x192.png',
                    badge: '/pwa-192x192.png',
                    vibrate: [200, 100, 200],
                },
                fcmOptions: {
                    link: payload.data?.url || '/',
                },
            },
        };

        const response = await messaging.sendEachForMulticast(message);
        console.log(`Push notifications sent: ${response.successCount} success, ${response.failureCount} failure`);

        return {
            success: response.successCount,
            failure: response.failureCount,
        };
    } catch (error) {
        console.error('Failed to send push notifications:', error);
        return { success: 0, failure: tokens.length };
    }
};

/**
 * Send proximity alert notification
 */
export const sendProximityAlert = async (
    token: string,
    pointType: 'museum' | 'work' | 'point',
    name: string,
    distance: number,
    url: string
): Promise<boolean> => {
    const typeLabels = {
        museum: 'museu',
        work: 'obra',
        point: 'ponto turístico',
    };

    const payload: PushNotificationPayload = {
        title: `Você está perto de um ${typeLabels[pointType]}!`,
        body: `"${name}" está a ${Math.round(distance)}m de você.`,
        data: {
            type: 'proximity',
            pointType,
            url,
            tag: `proximity-${pointType}`,
        },
    };

    return sendPushNotification(token, payload);
};
