// Content script - Boundless Analyzer
(function() {
    'use strict';

    const LOCK_SELECTOR = '0xb4206dd2';
    const BOUNDLESS_ABI = [
        "function lockRequest((uint256,(bytes32,(address,uint96),(uint8,bytes),bytes4),string,(uint8,bytes),(uint256,uint256,uint64,uint32,uint32,uint32,uint256)),bytes) external payable"
    ];
    
    const CONFIG = {
        RPC_URL: 'https://eth.llamarpc.com',
        COINGECKO_API: 'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd',
        ETHERSCAN_API: 'https://api.etherscan.io/v2/api'
    };

    let ethPrice = 0;
    let orderData = new Map();
    let tooltip = null;
    let tableOrderIds = [];
    let loadingOverlay = null;

    // Loading overlay oluştur
    function createLoadingOverlay() {
        const overlay = document.createElement('div');
        overlay.id = 'boundless-loading-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: linear-gradient(135deg, rgba(248, 246, 240, 0.55) 0%, rgba(241, 237, 228, 0.55) 100%);
            backdrop-filter: blur(8px);
            z-index: 999999;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            transition: opacity 0.5s ease;
        `;

        overlay.innerHTML = `
            <div style="text-align: center; max-width: 400px;">
                <div style="width: 80px; height: 80px; margin: 0 auto 32px; position: relative;">
                    <div style="
                        width: 80px;
                        height: 80px;
                        border: 3px solid #e5e0d3;
                        border-top: 3px solid #d4af37;
                        border-radius: 50%;
                        animation: spin 1s linear infinite;
                    "></div>
                    <div style="
                        position: absolute;
                        top: 50%;
                        left: 50%;
                        transform: translate(-50%, -50%);
                        font-size: 24px;
                    ">🍓</div>
                </div>
                
                <h2 style="
                    font-size: 24px;
                    font-weight: 600;
                    color: #2d2821;
                    margin-bottom: 8px;
                ">Analyzing Transactions</h2>
                
                <p style="
                    font-size: 16px;
                    color: #6b6654;
                    margin-bottom: 24px;
                    line-height: 1.5;
                ">Fetching your order data and calculating gas fees...</p>
                
                <div id="progress-text" style="
                    font-size: 14px;
                    color: #8b7355;
                    font-weight: 500;
                ">Initializing...</div>
            </div>
            
            <style>
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
            </style>
        `;

        document.body.appendChild(overlay);
        return overlay;
    }

    // Progress güncelle
    function updateProgress(message) {
        const progressText = document.getElementById('progress-text');
        if (progressText) {
            progressText.textContent = message;
        }
        console.log('📊', message);
    }

    // Loading overlay'i kapat
    function hideLoadingOverlay() {
        if (loadingOverlay) {
            loadingOverlay.style.opacity = '0';
            setTimeout(() => {
                if (loadingOverlay && loadingOverlay.parentNode) {
                    loadingOverlay.parentNode.removeChild(loadingOverlay);
                }
                loadingOverlay = null;
            }, 500);
        }
    }

    // ethers.js yükle (Chrome extension için güvenli yöntem)
    async function loadEthers() {
        if (typeof ethers !== 'undefined') {
            updateProgress('ethers.js already loaded ✅');
            return;
        }
        
        updateProgress('Loading ethers.js...');
        
        // Chrome extension için güvenli script injection
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = chrome.runtime.getURL('ethers.min.js');
            script.onload = () => {
                updateProgress('ethers.js loaded ✅');
                resolve();
            };
            script.onerror = (error) => {
                console.error('ethers.js load error:', error);
                reject(new Error('Failed to load ethers.js'));
            };
            
            // Script'i head'e ekle
            (document.head || document.documentElement).appendChild(script);
        });
    }

    // ETH fiyatını al
    async function getEthPrice() {
        try {
            updateProgress('Fetching ETH price...');
            const response = await fetch(CONFIG.COINGECKO_API);
            const data = await response.json();
            ethPrice = data.ethereum.usd;
            updateProgress(`ETH Price: $${ethPrice} ✅`);
        } catch (error) {
            console.error('ETH fiyat hatası:', error);
            ethPrice = 3000;
            updateProgress('Using fallback ETH price: $3000');
        }
    }

    // Cüzdan adresini URL'den al
    function getWalletAddress() {
        const path = window.location.pathname;
        const match = path.match(/\/provers\/(.+)$/);
        return match ? match[1] : null;
    }

    // Order ID'leri tablodan çıkar
    function extractOrderIds() {
        updateProgress('Extracting order IDs from table...');
        const orderIds = [];
        const table = document.querySelector('table.w-full');
        
        if (!table) {
            console.log('❌ Tablo bulunamadı');
            return orderIds;
        }

        const rows = table.querySelectorAll('tbody tr');
        console.log(`📊 ${rows.length} satır bulundu`);
        
        rows.forEach((row, index) => {
            const firstTd = row.querySelector('td:first-child');
            if (firstTd) {
                const span = firstTd.querySelector('div a span[title]');
                if (span) {
                    const orderIdText = span.getAttribute('title');
                    if (orderIdText && orderIdText.startsWith('0x')) {
                        orderIds.push({
                            orderId: orderIdText,
                            row: row,
                            index: index
                        });
                    }
                }
            }
        });

        tableOrderIds = orderIds.map(o => o.orderId);
        updateProgress(`Found ${tableOrderIds.length} orders in table ✅`);
        return orderIds;
    }

    // Tooltip oluştur
    function createTooltip() {
        if (tooltip) return tooltip;

        tooltip = document.createElement('div');
        tooltip.style.cssText = `
            position: absolute;
            background: linear-gradient(135deg, #1e293b 0%, #334155 100%);
            color: white;
            padding: 16px 20px;
            border-radius: 12px;
            font-size: 13px;
            font-weight: 500;
            box-shadow: 0 10px 30px rgba(0,0,0,0.4);
            z-index: 10000;
            pointer-events: auto;
            border: 1px solid rgba(255,255,255,0.1);
            opacity: 0;
            transition: opacity 0.3s ease;
            width: 250px;
            line-height: 1.4;
            backdrop-filter: blur(10px);
        `;
        
        tooltip.innerHTML = `
            <div class="tooltip-arrow-left"></div>
            <div class="tooltip-content"></div>
        `;
        
        document.body.appendChild(tooltip);
        return tooltip;
    }

    // Tooltip göster
    function showTooltip(event, orderId) {
        const data = orderData.get(orderId);
        if (!data) return;

        const tooltip = createTooltip();
        
        const lockFeeUsd = (data.lockFee * ethPrice).toFixed(2);
        const totalFailFeeUsd = (data.totalFailFee * ethPrice).toFixed(2);
        const totalCostUsd = ((data.lockFee + data.totalFailFee) * ethPrice).toFixed(2);

        const content = `
            <div style="font-weight: bold; margin-bottom: 8px; color: #ffd700;">
                💎 ${orderId.substring(0, 10)}...${orderId.substring(orderId.length - 8)}
            </div>
            <div style="margin-bottom: 4px;">
                🔒 Lock fee: <strong>$${lockFeeUsd}</strong> (${data.lockFee.toFixed(6)} ETH)
            </div>
            <div style="margin-bottom: 4px;">
                ❌ ${data.failTries} fails: <strong>$${totalFailFeeUsd}</strong> (${data.totalFailFee.toFixed(6)} ETH)
            </div>
            <div style="margin-bottom: 4px; font-size: 11px; opacity: 0.8;">
                📄 Success TX: ${data.txHash.substring(0, 10)}...
            </div>
            <div style="border-top: 1px solid rgba(255,255,255,0.3); padding-top: 4px; margin-top: 6px;">
                💸 Total cost: <strong>$${totalCostUsd}</strong>
            </div>
        `;
        
        tooltip.querySelector('.tooltip-content').innerHTML = content;

        const rect = event.target.closest('tr').getBoundingClientRect();
        const tooltipWidth = tooltip.offsetWidth;
        const tooltipHeight = tooltip.offsetHeight;

        tooltip.style.left = (rect.left + (rect.width / 2) - (tooltipWidth / 2)) + 'px';
        tooltip.style.top = (rect.top + window.scrollY + (rect.height / 2) - (tooltipHeight / 2)) + 'px';
        tooltip.style.opacity = '1';
    }

    // Tooltip gizle
    function hideTooltip() {
        if (tooltip) {
            tooltip.style.opacity = '0';
        }
    }

    // Hover event'leri ekle
    function addHoverEvents() {
        updateProgress('Adding hover events...');
        const table = document.querySelector('table.w-full');
        if (!table) {
            console.log('❌ Tablo bulunamadı - hover events eklenemedi');
            return;
        }

        const rows = table.querySelectorAll('tbody tr');
        let addedCount = 0;
        
        rows.forEach((row, index) => {
            const firstTd = row.querySelector('td:first-child');
            if (firstTd) {
                const span = firstTd.querySelector('div a span[title]');
                if (span) {
                    const orderId = span.getAttribute('title');
                    
                    if (orderData.has(orderId)) {
                        row.addEventListener('mouseenter', (event) => {
                            showTooltip(event, orderId);
                        });

                        row.addEventListener('mouseleave', hideTooltip);
                        
                        row.style.cursor = 'pointer';
                        row.style.transition = 'background-color 0.2s ease';
                        
                        row.addEventListener('mouseenter', () => {
                            row.style.backgroundColor = 'rgba(212, 175, 55, 0.1)';
                        });
                        
                        row.addEventListener('mouseleave', () => {
                            row.style.backgroundColor = '';
                        });
                        
                        if (!row.querySelector('.analysis-indicator')) {
                            const indicator = document.createElement('span');
                            indicator.className = 'analysis-indicator';
                            indicator.style.cssText = `
                                position: absolute;
                                right: 10px;
                                top: 50%;
                                transform: translateY(-50%);
                                width: 8px;
                                height: 8px;
                                background: #4ade80;
                                border-radius: 50%;
                                animation: pulse 2s infinite;
                                z-index: 100;
                            `;
                            row.style.position = 'relative';
                            row.appendChild(indicator);
                        }
                        addedCount++;
                    }
                }
            }
        });

        updateProgress(`Added hover events to ${addedCount} rows ✅`);
    }

    // Styles ekle
    function addStyles() {
        const style = document.createElement('style');
        style.textContent = `
            @keyframes pulse {
                0% { opacity: 1; }
                50% { opacity: 0.5; }
                100% { opacity: 1; }
            }
            
            .tooltip-arrow-left {
                position: absolute;
                left: -12px;
                top: 58px;
                width: 0;
                height: 0;
                border-top: 10px solid transparent;
                border-bottom: 10px solid transparent;
                border-right: 12px solid #334155;
                z-index: 10001;
            }
            
            .tooltip-arrow-left::before {
                content: '';
                position: absolute;
                left: 1px;
                top: -10px;
                width: 0;
                height: 0;
                border-top: 10px solid transparent;
                border-bottom: 10px solid transparent;
                border-right: 12px solid rgba(255,255,255,0.1);
            }
            
            .tooltip-content {
                position: relative;
                z-index: 10002;
            }
        `;
        document.head.appendChild(style);
    }

    // Transaction'ları analiz et
    async function analyzeLockRequests(walletAddress, apiKey) {
        try {
            updateProgress('Fetching transaction history...');
            
            const txHistoryUrl = `${CONFIG.ETHERSCAN_API}?chainid=8453&module=account&action=txlist&address=${walletAddress}&page=1&offset=1300&sort=desc&apikey=${apiKey}`;
            
            const response = await fetch(txHistoryUrl);
            const data = await response.json();
            
            if (data.status !== '1') {
                throw new Error('Etherscan API error: ' + data.message);
            }

            updateProgress(`Processing ${data.result.length} transactions...`);

            // Sadece lockRequest transaction'ları filtrele
            const allLockRequests = data.result.filter(tx => 
                tx.input && tx.input.startsWith(LOCK_SELECTOR)
            );

            updateProgress(`Found ${allLockRequests.length} lockRequest transactions`);

            if (allLockRequests.length === 0) {
                updateProgress('No lockRequest transactions found ⚠️');
                return;
            }

            // ABI interface oluştur
            const iface = new ethers.utils.Interface(BOUNDLESS_ABI);

            // Transaction'ları tarih sırasına göre sırala (eskiden yeniye)
            allLockRequests.sort((a, b) => parseInt(a.timeStamp) - parseInt(b.timeStamp));

            let processedTransactions = [];

            updateProgress('Decoding transaction data...');

            // Tüm lockRequest'leri işle
            for (let i = 0; i < allLockRequests.length; i++) {
                const tx = allLockRequests[i];
                
                try {
                    // Input data'yı decode et
                    const decoded = iface.parseTransaction({ data: tx.input });
                    const requestStruct = decoded.args[0];
                    const requestId = requestStruct[0];
                    
                    if (!requestId) continue;
                    
                    const orderIdHex = requestId._hex.toLowerCase();
                    const isSuccess = tx.txreceipt_status === '1' && tx.isError === '0';
                    
                    // Gas fee hesapla
                    const gasUsed = parseInt(tx.gasUsed);
                    const gasPrice = parseInt(tx.gasPrice);
                    const txFeeWei = gasUsed * gasPrice;
                    const txFeeEth = txFeeWei / Math.pow(10, 18);
                    
                    processedTransactions.push({
                        orderId: orderIdHex,
                        txHash: tx.hash,
                        isSuccess: isSuccess,
                        feeEth: txFeeEth,
                        timestamp: parseInt(tx.timeStamp),
                        index: i
                    });
                    
                } catch (decodeError) {
                    console.error(`❌ Decode error TX ${i+1}:`, decodeError.message);
                }
            }

            updateProgress(`Processed ${processedTransactions.length} transactions`);

            // Sadece başarılı transaction'ları al
            const successfulTxs = processedTransactions.filter(tx => tx.isSuccess);
            updateProgress(`Found ${successfulTxs.length} successful transactions`);

            let matchedCount = 0;

            updateProgress('Matching with table orders...');

            // Her başarılı transaction için analiz yap
            for (let i = 0; i < successfulTxs.length; i++) {
                const successTx = successfulTxs[i];
                
                // Tablodaki Order ID'lerle eşleştir
                const matchingId = tableOrderIds.find(id => 
                    id.toLowerCase() === successTx.orderId
                );
                
                if (!matchingId) continue;

                matchedCount++;

                // Bu başarılı TX'in index'ini bul
                const currentSuccessIndex = successTx.index;
                
                // Bir önceki başarılı TX'in index'ini bul
                let previousSuccessIndex = -1;
                if (i > 0) {
                    previousSuccessIndex = successfulTxs[i - 1].index;
                }

                // İki başarılı TX arasındaki fail'leri bul
                const failsBetween = processedTransactions.filter(tx => 
                    !tx.isSuccess && 
                    tx.index > previousSuccessIndex && 
                    tx.index < currentSuccessIndex
                );

                let totalFailFee = 0;
                let failTxHashes = [];
                
                failsBetween.forEach(fail => {
                    totalFailFee += fail.feeEth;
                    failTxHashes.push(fail.txHash);
                });

                // Data'yı kaydet
                orderData.set(matchingId, {
                    lockFee: successTx.feeEth,
                    failTries: failsBetween.length,
                    totalFailFee: totalFailFee,
                    txHash: successTx.txHash,
                    failTxHashes: failTxHashes,
                    timestamp: new Date(successTx.timestamp * 1000),
                    requestId: successTx.orderId
                });
            }

            updateProgress(`Matched ${matchedCount} orders with transaction data ✅`);

        } catch (error) {
            console.error('❌ Analysis error:', error);
            updateProgress('Analysis failed ❌');
            throw error;
        }
    }

    // Ana analiz fonksiyonu
    async function runAnalysis(apiKey) {
        try {
            // Loading overlay göster
            loadingOverlay = createLoadingOverlay();
            
            updateProgress('Starting analysis...');
            
            await loadEthers();
            addStyles();
            
            const walletAddress = getWalletAddress();
            if (!walletAddress) {
                throw new Error('Wallet address not found in URL');
            }

            updateProgress(`Analyzing wallet: ${walletAddress.substring(0, 10)}...`);

            await getEthPrice();
            
            const orderIds = extractOrderIds();
            if (orderIds.length === 0) {
                throw new Error('No orders found in table');
            }

            await analyzeLockRequests(walletAddress, apiKey);
            
            updateProgress('Adding interactive features...');
            addHoverEvents();

            // Final özet hesapla
            if (orderData.size > 0) {
                let totalLockFee = 0;
                let totalFailFee = 0;
                let totalFails = 0;
                
                orderData.forEach(data => {
                    totalLockFee += data.lockFee;
                    totalFailFee += data.totalFailFee;
                    totalFails += data.failTries;
                });
                
                updateProgress(`Analysis complete! Total cost: ${((totalLockFee + totalFailFee) * ethPrice).toFixed(2)} ✅`);
                
                console.log(`📊 FINAL SUMMARY:`);
                console.log(`   📋 Total orders in table: ${tableOrderIds.length}`);
                console.log(`   ✅ Matched orders: ${orderData.size}`);
                console.log(`   💰 Total lock fees: ${(totalLockFee * ethPrice).toFixed(2)}`);
                console.log(`   ❌ Total fail fees: ${(totalFailFee * ethPrice).toFixed(2)}`);
                console.log(`   🔢 Total fails: ${totalFails}`);
                console.log(`   💸 TOTAL COST: ${((totalLockFee + totalFailFee) * ethPrice).toFixed(2)}`);
            }

            // 2 saniye bekle, sonra loading'i kapat
            setTimeout(() => {
                hideLoadingOverlay();
            }, 2000);

        } catch (error) {
            console.error('❌ Main error:', error);
            updateProgress(`Error: ${error.message} ❌`);
            
            // 3 saniye bekle, sonra loading'i kapat
            setTimeout(() => {
                hideLoadingOverlay();
            }, 3000);
        }
    }

    // Extension'dan mesaj dinle
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'runAnalysis') {
            runAnalysis(request.apiKey);
            sendResponse({ success: true });
        }
    });

    console.log('🚀 Boundless Analyzer content script loaded');
})();