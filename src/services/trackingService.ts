import { initializeApp } from "firebase/app";
import { getDatabase, ref, set, onValue, off, remove } from "firebase/database";

const firebaseConfig = {
    apiKey: "AIzaSyBa8lMbvu-GeiZg0UXllYtT6OKYStlIT-E",
    authDomain: "livetrackingtikovia.firebaseapp.com",
    databaseURL: "https://livetrackingtikovia-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "livetrackingtikovia",
    storageBucket: "livetrackingtikovia.firebasestorage.app",
    messagingSenderId: "200075627099",
    appId: "1:200075627099:web:d33d2f330c08ef8d230d7e",
    measurementId: "G-B4BHV1HQB1"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
 
export const sendDriverLocation = (driverId: string, info: {
    name: string,
    lat: number,
    lng: number,
    orderId?: string
}) => {
    const driverRef = ref(db, 'drivers/' + driverId);
    set(driverRef, {
        ...info,
        lastUpdated: Date.now()
    }).catch(err => console.error("Lỗi gửi vị trí:", err));
};

export const subscribeToDrivers = (callback: (drivers: any[]) => void) => {
    const driversRef = ref(db, 'drivers');
    const unsubscribe = onValue(driversRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
            const list = Object.keys(data).map(key => ({
                id: key,
                ...data[key]
            }));
            callback(list);
        } else {
            callback([]);
        }
    });

    return () => off(driversRef, 'value', unsubscribe);
};

export const removeDriverLocation = (driverId: string) => {
    remove(ref(db, 'drivers/' + driverId));
};