import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import io from 'socket.io-client';
import { QRCodeSVG } from 'qrcode.react';

export default function Dashboard() {
    const [status, setStatus] = useState('disconnected');
    const [qrCode, setQrCode] = useState('');
    const [userId, setUserId] = useState('');
    const socketRef = useRef();
    const router = useRouter();

    useEffect(() => {
        // 1. Check Auth
        const storedUserId = localStorage.getItem('userId');
        const parentPhone = localStorage.getItem('parentPhone');

        if (!storedUserId) {
            router.push('/');
            return;
        }
        setUserId(storedUserId);

        // 2. Connect Socket
        socketRef.current = io('http://localhost:3000');

        socketRef.current.emit('join_room', storedUserId);

        socketRef.current.on('qr_code', (qr) => {
            console.log('Received QR');
            setQrCode(qr);
            setStatus('scanning');
        });

        socketRef.current.on('status', (newStatus) => {
            console.log('Status Update:', newStatus);
            setStatus(newStatus);
            if (newStatus === 'connected') {
                setQrCode(''); // Clear QR on success
            }
        });

        return () => {
            socketRef.current.disconnect();
        };
    }, []);

    const startMonitoring = async () => {
        const storedUserId = localStorage.getItem('userId');
        const parentPhone = localStorage.getItem('parentPhone');

        setStatus('initializing');
        fetch('/api/monitor/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: storedUserId, parentPhoneNumber: parentPhone })
        });
    };

    return (
        <div className="container">
            <div className="card">
                <h1>Safety Dashboard</h1>
                <p>User ID: {userId}</p>
                <p>Status: <strong>{status.toUpperCase()}</strong></p>

                {status === 'disconnected' && (
                    <button className="btn" onClick={startMonitoring}>
                        Add Child Device
                    </button>
                )}

                {status === 'initializing' && <p>Please wait, contacting server...</p>}

                {qrCode && (
                    <div style={{ marginTop: '20px', textAlign: 'center' }}>
                        <QRCodeSVG value={qrCode} size={256} />
                        <p>Scan this with your Child's WhatsApp (Linked Devices)</p>
                    </div>
                )}

                {status === 'connected' && (
                    <div style={{ marginTop: '20px', color: 'green', textAlign: 'center' }}>
                        <h2>✅ Monitoring Active</h2>
                        <p>Ensure the child's phone stays online.</p>
                    </div>
                )}
            </div>
        </div>
    );
}
