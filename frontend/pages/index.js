import { useState, useEffect } from 'react';
import Head from 'next/head';

const API = 'http://localhost:3001';

export default function Dashboard() {
    const [status, setStatus] = useState(null);
    const [alerts, setAlerts] = useState([]);
    const [parentInput, setParentInput] = useState('');
    const [childInput, setChildInput] = useState('');
    const [msg, setMsg] = useState('');
    const [loading, setLoading] = useState(true);
    const [isEditingParent, setIsEditingParent] = useState(false);
    const [isAddingChild, setIsAddingChild] = useState(false);

    const fetchStatus = async () => {
        try {
            const res = await fetch(`${API}/api/status`);
            const data = await res.json();
            setStatus(data);
            if (data.childSessions?.length > 0) {
                fetchAlerts(data.childSessions[0].userId);
            }
        } catch { setStatus(null); }
        setLoading(false);
    };

    const fetchAlerts = async (userId) => {
        try {
            const res = await fetch(`${API}/api/alerts?userId=${userId}`);
            const data = await res.json();
            if (data.success) setAlerts(data.alerts);
        } catch {}
    };

    useEffect(() => { fetchStatus(); const i = setInterval(fetchStatus, 10000); return () => clearInterval(i); }, []);

    const updateParent = async () => {
        if (!parentInput) return;
        setMsg('');
        try {
            const res = await fetch(`${API}/api/parent-number`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phoneNumber: parentInput }) });
            const data = await res.json();
            if (data.success) { setMsg(`Parent updated to ${data.parentNumber}`); setParentInput(''); fetchStatus(); }
            else setMsg(data.error);
        } catch { setMsg('Failed to connect to backend'); }
    };

    const reconnect = async () => {
        if (!childInput) return;
        setMsg('');
        try {
            const res = await fetch(`${API}/api/reconnect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ childNumber: childInput }) });
            const data = await res.json();
            setMsg(data.message || data.error);
            setChildInput('');
            setTimeout(fetchStatus, 3000);
        } catch { setMsg('Failed to connect to backend'); }
    };

    const disconnect = async (userId) => {
        if (!confirm('Disconnect this child device?')) return;
        try {
            const res = await fetch(`${API}/api/reset`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId }) });
            const data = await res.json();
            setMsg(data.message || data.error);
            fetchStatus();
        } catch { setMsg('Failed to connect to backend'); }
    };

    const blockContact = async (userId, targetJid) => {
        if (!confirm('Block this contact on the child\'s phone?')) return;
        try {
            const res = await fetch(`${API}/api/action/block`, { 
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' }, 
                body: JSON.stringify({ userId, targetJid }) 
            });
            const data = await res.json();
            setMsg(data.message || data.error);
        } catch { setMsg('Failed to connect to backend'); }
    };

    if (loading) return (
        <>
            <Head><title>GuardianLink Dashboard</title><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" /></Head>
            <div className="wrapper" style={{ paddingTop: '6rem' }}><div className="spinner"></div></div>
        </>
    );

    return (
        <>
            <Head>
                <title>GuardianLink Dashboard</title>
                <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
            </Head>

            <div className="wrapper dashboard-wrapper">
                {/* Header */}
                <header className="main-header" style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%' }}>
                    <div className="logo-container">
                        <svg className="logo-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M12 22C12 22 20 18 20 12V5L12 2L4 5V12C4 18 12 22 12 22Z" stroke="url(#lg)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d="M12 8V16" stroke="url(#lg)" strokeWidth="2.5" strokeLinecap="round"/>
                            <path d="M9 12H15" stroke="url(#lg)" strokeWidth="2.5" strokeLinecap="round"/>
                            <defs><linearGradient id="lg" x1="4" y1="2" x2="20" y2="22" gradientUnits="userSpaceOnUse"><stop stopColor="#818cf8"/><stop offset="1" stopColor="#c084fc"/></linearGradient></defs>
                        </svg>
                        <span className="logo-text">Guardian<span>Link</span></span>
                    </div>
                    <span style={{ fontSize: '0.8rem', color: status?.botOnline ? '#10b981' : '#ef4444', fontWeight: 600 }}>
                        {status?.botOnline ? '● Bot Online' : '● Bot Offline'}
                    </span>
                </header>

                {msg && <div style={{ background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: '12px', padding: '0.75rem 1rem', color: '#a5b4fc', fontSize: '0.85rem', textAlign: 'center' }}>{msg}</div>}

                {/* Status Cards Row */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    {/* Parent Number Card */}
                    <div className="glass-card" style={{ padding: '1.5rem' }}>
                        <h3 style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem' }}>Parent Number</h3>
                        <p style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '1rem' }}>
                            {status?.parentNumber ? `+${status.parentNumber}` : 'Not Set'}
                        </p>
                        <button className="btn btn-secondary" style={{ width: 'auto', padding: '0.5rem 1rem', fontSize: '0.8rem' }} onClick={() => setIsEditingParent(true)}>Change Number</button>
                    </div>

                    {/* Child Sessions Card */}
                    <div className="glass-card" style={{ padding: '1.5rem' }}>
                        <h3 style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem' }}>Child Devices</h3>
                        {status?.childSessions?.length > 0 ? (
                            status.childSessions.map((s, i) => (
                                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                                    <div>
                                        <span style={{ color: '#10b981', marginRight: '0.5rem' }}>●</span>
                                        <span style={{ fontWeight: 600 }}>+{s.childPhone}</span>
                                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>Connected</span>
                                    </div>
                                    <button className="btn btn-danger" style={{ width: 'auto', padding: '0.4rem 0.8rem', fontSize: '0.75rem' }} onClick={() => disconnect(s.userId)}>Disconnect</button>
                                </div>
                            ))
                        ) : (
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '0.75rem' }}>No devices linked</p>
                        )}
                        {(!status?.childSessions?.length || isAddingChild) ? (
                            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                                <input type="tel" placeholder="Child phone number" value={childInput} onChange={e => setChildInput(e.target.value)} style={{ flex: 1, fontSize: '0.85rem', padding: '0.6rem 0.8rem' }} />
                                <button className="btn btn-primary" style={{ width: 'auto', padding: '0.6rem 1rem', fontSize: '0.8rem' }} onClick={() => { reconnect(); setIsAddingChild(false); }}>Connect</button>
                                {status?.childSessions?.length > 0 && (
                                    <button className="btn" style={{ background: 'rgba(255,255,255,0.1)', width: 'auto', padding: '0.6rem 1rem', fontSize: '0.8rem' }} onClick={() => setIsAddingChild(false)}>Cancel</button>
                                )}
                            </div>
                        ) : (
                            <button className="btn" style={{ background: 'rgba(255,255,255,0.1)', width: '100%', padding: '0.6rem', fontSize: '0.85rem', marginTop: '0.75rem', border: '1px dashed rgba(255,255,255,0.3)' }} onClick={() => setIsAddingChild(true)}>+ Link Another Device</button>
                        )}
                    </div>
                </div>

                {/* Alerts Table */}
                <div className="glass-card" style={{ padding: '1.5rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                        <h3 style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Safety Alerts</h3>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{alerts.length} flagged</span>
                    </div>

                    {alerts.length === 0 ? (
                        <div className="text-center" style={{ padding: '2rem 0', color: 'var(--text-muted)' }}>
                            <p>No safety alerts yet.</p>
                            <p style={{ fontSize: '0.8rem', marginTop: '0.5rem' }}>Only NDPR-compliant flagged messages appear here.</p>
                        </div>
                    ) : (
                        <div style={{ overflowX: 'auto' }}>
                            <table className="alerts-table">
                                <thead>
                                    <tr>
                                        <th>Time</th>
                                        <th>Sender</th>
                                        <th>Risk</th>
                                        <th>Reason</th>
                                        <th>Message</th>
                                        <th>Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {alerts.map((a, i) => (
                                        <tr key={i}>
                                            <td style={{ whiteSpace: 'nowrap' }}>{new Date(a.timestamp).toLocaleString()}</td>
                                            <td>
                                                {a.senderName}
                                                <br /><span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{a.senderJid?.split('@')[0]}</span>
                                            </td>
                                            <td><span className={`badge badge-${a.severity || 'MEDIUM'}`}>{a.severity || 'MEDIUM'}</span></td>
                                            <td>{a.reason}</td>
                                            <td style={{ fontStyle: 'italic', color: 'var(--text-secondary)', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{`"${a.content}"`}</td>
                                            <td>
                                                <button className="btn btn-danger btn-sm" onClick={() => blockContact(a.userId, a.senderJid)}>Block</button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>

            {/* Parent Number Modal */}
            {isEditingParent && (
                <div className="modal-overlay" onClick={() => setIsEditingParent(false)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                        <h2 className="modal-header">Update Parent Number</h2>
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>Enter the new WhatsApp number to receive safety alerts.</p>
                        <input type="tel" placeholder="2349034632271" value={parentInput} onChange={e => setParentInput(e.target.value)} style={{ marginBottom: '1rem' }} />
                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                            <button className="btn btn-secondary" onClick={() => setIsEditingParent(false)}>Cancel</button>
                            <button className="btn btn-primary" onClick={() => { updateParent(); setIsEditingParent(false); }}>Save Changes</button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
