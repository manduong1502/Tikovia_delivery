import React, { useState } from 'react';
import { kiotVietService, KVConfig } from '../services/kiotVietService';
import { importKiotVietCustomers, importKiotVietOrders } from '../services/mockDb';

interface KiotVietSyncModalProps {
    onClose: () => void;
    onSyncComplete: () => void;
}

const KiotVietSyncModal: React.FC<KiotVietSyncModalProps> = ({ onClose, onSyncComplete }) => {
    // In a real app, do NOT default these. For demo, we leave empty.
    const [clientId, setClientId] = useState('');
    const [clientSecret, setClientSecret] = useState('');
    const [retailer, setRetailer] = useState('');
    
    const [step, setStep] = useState<'AUTH' | 'SYNC'>('AUTH');
    const [token, setToken] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [log, setLog] = useState<string[]>([]);

    const addLog = (msg: string) => setLog(prev => [...prev, msg]);

    const handleConnect = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        
        try {
            const config: KVConfig = { clientId, clientSecret, retailer };
            addLog("Đang kết nối đến KiotViet ID...");
            const accessToken = await kiotVietService.getAccessToken(config);
            setToken(accessToken);
            addLog("Kết nối thành công! Đã nhận Access Token.");
            setStep('SYNC');
        } catch (err: any) {
            setError(err.message || "Lỗi kết nối. Vui lòng kiểm tra Client ID và Secret.");
            addLog("Lỗi kết nối.");
        } finally {
            setLoading(false);
        }
    };

    const handleSyncCustomers = async () => {
        setLoading(true);
        try {
            addLog("Đang tải danh sách khách hàng...");
            const kvCustomers = await kiotVietService.getCustomers(token, retailer);
            addLog(`Đã tải ${kvCustomers.length} khách hàng từ KiotViet.`);
            
            const importedCount = await importKiotVietCustomers(kvCustomers);
            addLog(`-> Đã thêm mới ${importedCount} khách hàng vào hệ thống.`);
            onSyncComplete();
        } catch (e) {
            addLog("Lỗi khi đồng bộ khách hàng.");
        } finally {
            setLoading(false);
        }
    };

    const handleSyncOrders = async () => {
        setLoading(true);
        try {
            addLog("Đang tải hóa đơn gần đây...");
            const kvInvoices = await kiotVietService.getRecentInvoices(token, retailer);
            addLog(`Đã tải ${kvInvoices.length} hóa đơn.`);
            
            const importedCount = await importKiotVietOrders(kvInvoices);
            addLog(`-> Đã tạo ${importedCount} đơn hàng giao nhận mới.`);
            onSyncComplete();
        } catch (e) {
            addLog("Lỗi khi đồng bộ hóa đơn.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-slide-up">
                {/* Header */}
                <div className="bg-blue-600 p-4 flex justify-between items-center text-white">
                    <h2 className="text-lg font-bold flex items-center gap-2">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                        Đồng bộ KiotViet
                    </h2>
                    <button onClick={onClose} className="hover:bg-blue-700 p-1 rounded-full">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </div>

                <div className="p-6">
                    {step === 'AUTH' && (
                        <form onSubmit={handleConnect} className="space-y-4">
                            <div className="bg-blue-50 border border-blue-200 p-3 rounded text-sm text-blue-800 mb-4">
                                <strong>Lưu ý:</strong> Bạn cần lấy Client ID & Client Secret trong phần <strong>Thiết lập &gt; Kết nối API</strong> trên KiotViet.
                            </div>

                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-1">Tên gian hàng (Retailer)</label>
                                <input 
                                    required
                                    value={retailer}
                                    onChange={e => setRetailer(e.target.value)}
                                    placeholder="vd: mykiotshop"
                                    className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-1">Client ID</label>
                                <input 
                                    required
                                    value={clientId}
                                    onChange={e => setClientId(e.target.value)}
                                    placeholder="Nhập Client ID"
                                    className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 outline-none font-mono text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-1">Client Secret</label>
                                <input 
                                    required
                                    type="password"
                                    value={clientSecret}
                                    onChange={e => setClientSecret(e.target.value)}
                                    placeholder="Nhập Client Secret"
                                    className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 outline-none font-mono text-sm"
                                />
                            </div>

                            {error && <div className="text-red-500 text-sm font-medium">{error}</div>}

                            <button 
                                type="submit"
                                disabled={loading}
                                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-lg shadow transition-colors flex justify-center items-center gap-2"
                            >
                                {loading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>}
                                Kết nối
                            </button>
                        </form>
                    )}

                    {step === 'SYNC' && (
                        <div className="space-y-6">
                            <div className="flex items-center gap-3 bg-green-50 p-3 rounded border border-green-200">
                                <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center text-green-600">
                                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                </div>
                                <div>
                                    <div className="font-bold text-green-800">Đã kết nối</div>
                                    <div className="text-xs text-green-600">Token Active</div>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <button 
                                    onClick={handleSyncCustomers}
                                    disabled={loading}
                                    className="flex flex-col items-center justify-center p-4 border border-gray-200 rounded-xl hover:bg-gray-50 active:scale-95 transition-all"
                                >
                                    <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center text-purple-600 mb-2">
                                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
                                    </div>
                                    <span className="font-bold text-gray-700">Đồng bộ Khách hàng</span>
                                </button>

                                <button 
                                    onClick={handleSyncOrders}
                                    disabled={loading}
                                    className="flex flex-col items-center justify-center p-4 border border-gray-200 rounded-xl hover:bg-gray-50 active:scale-95 transition-all"
                                >
                                    <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center text-orange-600 mb-2">
                                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
                                    </div>
                                    <span className="font-bold text-gray-700">Tải Hóa đơn Mới</span>
                                </button>
                            </div>

                            {/* Logs Console */}
                            <div className="bg-gray-900 rounded-lg p-3 h-32 overflow-y-auto font-mono text-xs text-green-400">
                                {log.length === 0 ? <span className="text-gray-500">Ready to sync...</span> : log.map((line, i) => (
                                    <div key={i}>&gt; {line}</div>
                                ))}
                                {loading && <div className="animate-pulse">&gt; Processing...</div>}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default KiotVietSyncModal;