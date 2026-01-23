// PartitionsSamples.js - IndexedDB storage for user-uploaded samples

class PartitionsSamples {
    constructor() {
        this.dbPromise = null;
    }

    openDB() {
        if (this.dbPromise) return this.dbPromise;
        this.dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open('lrc-partitions-samples', 1);
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('samples')) {
                    db.createObjectStore('samples', { keyPath: 'id', autoIncrement: true });
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        return this.dbPromise;
    }

    async addFiles(files = []) {
        if (!files.length) return [];
        const db = await this.openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('samples', 'readwrite');
            const store = tx.objectStore('samples');
            const stored = [];

            files.forEach((file) => {
                const record = {
                    name: file.name,
                    type: file.type || 'audio/wav',
                    blob: file,
                    lastModified: file.lastModified || Date.now()
                };
                const request = store.add(record);
                request.onsuccess = () => {
                    stored.push({ ...record, id: request.result });
                };
            });

            tx.oncomplete = () => resolve(stored);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    }

    async getAllSamples() {
        const db = await this.openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('samples', 'readonly');
            const store = tx.objectStore('samples');
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }
}

window.PartitionsSamples = PartitionsSamples;
