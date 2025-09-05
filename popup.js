document.addEventListener('DOMContentLoaded', async () => {
    const apiKeyInput = document.getElementById('api-key');
    const toggleBtn = document.getElementById('toggle-visibility');
    const saveBtn = document.getElementById('save-btn');
    const runBtn = document.getElementById('run-btn');
    const status = document.getElementById('status');
    const loading = runBtn.querySelector('.loading');
    const btnText = runBtn.querySelector('.btn-text');
    const txLimitSlider = document.getElementById('tx-limit');
    const sliderValue = document.getElementById('slider-value');

    // Kaydedilen değerleri yükle
    const result = await chrome.storage.sync.get(['etherscanApiKey', 'txLimit']);
    if (result.etherscanApiKey) {
        apiKeyInput.value = result.etherscanApiKey;
    }
    if (result.txLimit) {
        txLimitSlider.value = result.txLimit;
    }

    // Slider değerini güncelle
    function updateSliderValue(value) {
        const offset = value * 10;
        sliderValue.textContent = `${offset} transactions`;
    }

    // İlk yüklemede slider değerini güncelle
    updateSliderValue(txLimitSlider.value);

    // Slider değiştiğinde güncelle
    txLimitSlider.addEventListener('input', (e) => {
        updateSliderValue(e.target.value);
    });

    // Password visibility toggle
    toggleBtn.addEventListener('click', () => {
        if (apiKeyInput.type === 'password') {
            apiKeyInput.type = 'text';
            toggleBtn.textContent = '🙈';
        } else {
            apiKeyInput.type = 'password';
            toggleBtn.textContent = '👁️';
        }
    });

    // Status mesajı göster
    function showStatus(message, type) {
        status.textContent = message;
        status.className = `status ${type} show`;
        setTimeout(() => {
            status.classList.remove('show');
        }, 3000);
    }

    // API key ve tx limit kaydet
    saveBtn.addEventListener('click', async () => {
        const apiKey = apiKeyInput.value.trim();
        const txLimit = txLimitSlider.value;
        
        if (!apiKey) {
            showStatus('Please enter an API key', 'error');
            return;
        }

        try {
            await chrome.storage.sync.set({ 
                etherscanApiKey: apiKey,
                txLimit: txLimit
            });
            showStatus('Settings saved successfully!', 'success');
        } catch (error) {
            showStatus('Error saving settings', 'error');
        }
    });

    // Analizi çalıştır
    runBtn.addEventListener('click', async () => {
        const apiKey = apiKeyInput.value.trim();
        const txLimit = txLimitSlider.value;
        
        if (!apiKey) {
            showStatus('Please enter and save your API key first', 'error');
            return;
        }

        // Loading state
        runBtn.disabled = true;
        loading.style.display = 'flex';
        btnText.style.display = 'none';

        try {
            // Active tab'ı al
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            if (!tab.url.includes('explorer.beboundless.xyz/provers/')) {
                showStatus('Please navigate to a Boundless prover page', 'error');
                return;
            }

            // Content script inject et (eğer yüklenmemişse)
            try {
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: ['ethers.min.js', 'content.js']
                });
            } catch (injectError) {
                console.log('Script already injected or injection failed:', injectError);
            }

            // Kısa bir bekleme
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Content script'e mesaj gönder
            const response = await chrome.tabs.sendMessage(tab.id, {
                action: 'runAnalysis',
                apiKey: apiKey,
                txLimit: txLimit
            });

            showStatus('Analysis started! Check the page.', 'success');
            
            // 2 saniye sonra popup'ı kapat
            setTimeout(() => {
                window.close();
            }, 2000);

        } catch (error) {
            console.error('Run error:', error);
            if (error.message.includes('Receiving end does not exist')) {
                showStatus('Please refresh the page and try again', 'error');
            } else if (error.message.includes('Cannot access')) {
                showStatus('Please make sure you are on the correct page', 'error');
            } else {
                showStatus('Error: ' + error.message, 'error');
            }
        } finally {
            // Loading state'i temizle
            runBtn.disabled = false;
            loading.style.display = 'none';
            btnText.style.display = 'block';
        }
    });

    // Enter tuşu ile kaydet
    apiKeyInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            saveBtn.click();
        }
    });
});