import { useState } from 'react';
import { useRouter } from 'next/router';

export default function Home() {
    const [phoneNumber, setPhoneNumber] = useState('');
    const [otp, setOtp] = useState('');
    const [step, setStep] = useState(1); // 1: Phone, 2: OTP
    const router = useRouter();

    const handleSendOtp = async (e) => {
        e.preventDefault();
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phoneNumber }),
        });
        const data = await res.json();
        if (data.success) {
            setStep(2);
        } else {
            alert('Error sending OTP');
        }
    };

    const handleVerifyOtp = async (e) => {
        e.preventDefault();
        const res = await fetch('/api/auth/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phoneNumber, otp }),
        });
        const data = await res.json();
        if (data.success) {
            // Save user ID to local storage (simple auth for prototype)
            localStorage.setItem('userId', data.userId);
            localStorage.setItem('parentPhone', phoneNumber);
            router.push('/dashboard');
        } else {
            alert('Invalid OTP');
        }
    };

    return (
        <div className="container">
            <div className="card">
                <h1>Child Safety Login</h1>

                {step === 1 ? (
                    <form onSubmit={handleSendOtp}>
                        <p>Enter your phone number to receive a login code via WhatsApp.</p>
                        <input
                            type="tel"
                            className="input"
                            placeholder="e.g. 2347012345678"
                            value={phoneNumber}
                            onChange={(e) => setPhoneNumber(e.target.value)}
                            required
                        />
                        <button className="btn" type="submit">Send OTP</button>
                    </form>
                ) : (
                    <form onSubmit={handleVerifyOtp}>
                        <p>Enter the code sent to your WhatsApp.</p>
                        <input
                            type="text"
                            className="input"
                            placeholder="123456"
                            value={otp}
                            onChange={(e) => setOtp(e.target.value)}
                            required
                        />
                        <button className="btn" type="submit">Verify & Login</button>
                    </form>
                )}
            </div>
        </div>
    );
}
