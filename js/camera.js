// camera.js — photo capture via file input (works on all mobile browsers)
// The timestamp captured here is used as evidence of presence at the location.

export const camera = {
    photoData: null,   // base64 data URL
    photoTime: null,   // Date object — captured as close to shutter as possible

    capture() {
        return new Promise((resolve, reject) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.capture = 'environment';   // rear camera on mobile

            input.onchange = (e) => {
                const file = e.target.files[0];
                if (!file) { reject(new Error('No photo selected')); return; }

                // Capture time immediately on file selection — as close to shutter as possible.
                // EXIF data may also contain the exact time but requires parsing;
                // the selection time is accurate enough and requires no libraries.
                this.photoTime = new Date();

                const reader = new FileReader();
                reader.onload = (ev) => {
                    this.photoData = ev.target.result;
                    resolve({ data: this.photoData, time: this.photoTime });
                };
                reader.onerror = () => reject(new Error('Could not read photo'));
                reader.readAsDataURL(file);
            };

            input.oncancel = () => reject(new Error('Cancelled'));
            input.click();
        });
    },

    clear() {
        this.photoData = null;
        this.photoTime = null;
    },
};
