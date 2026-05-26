document.addEventListener('DOMContentLoaded', function() {
    const container = document.getElementById('container');
    const toggleBtn = document.getElementById('sidebar-toggle');
    
    // Toggle sidebar
    toggleBtn.addEventListener('click', function() {
        container.classList.toggle('sidebar-closed');
    });
    
    // Token form handler
    document.getElementById('token-form').addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const username = document.getElementById('username').value;
        const phone = document.getElementById('phone').value;
        const submitBtn = this.querySelector('button[type="submit"]');
        const resultMsg = document.getElementById('result-message');
        const tokenDisplay = document.getElementById('token-display');
        
        // Reset UI
        resultMsg.classList.add('hidden');
        resultMsg.className = '';
        tokenDisplay.classList.add('hidden');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Generating...';
        
        try {
            const response = await fetch('/api/generate-token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username, phone })
            });
            
            const data = await response.json();
            
            if (data.success) {
                document.getElementById('token-value').value = data.token;
                
                const expiryDate = new Date(data.expiry);
                document.getElementById('expiry-date').textContent = expiryDate.toLocaleString();
                
                tokenDisplay.classList.remove('hidden');
            } else {
                resultMsg.textContent = data.message;
                resultMsg.classList.add('error');
                resultMsg.classList.remove('hidden');
            }
        } catch (error) {
            console.error('Error:', error);
            resultMsg.textContent = 'Network error or server is down. Please try again later.';
            resultMsg.classList.add('error');
            resultMsg.classList.remove('hidden');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Generate Token';
        }
    });
    
    // Copy button handler
    document.getElementById('copy-btn').addEventListener('click', function() {
        const tokenInput = document.getElementById('token-value');
        tokenInput.select();
        tokenInput.setSelectionRange(0, 99999);
        
        navigator.clipboard.writeText(tokenInput.value).then(() => {
            const originalText = this.textContent;
            this.textContent = 'Copied!';
            this.style.backgroundColor = '#17a2b8';
            this.style.borderColor = '#17a2b8';
            
            setTimeout(() => {
                this.textContent = originalText;
                this.style.backgroundColor = '#28a745';
                this.style.borderColor = '#28a745';
            }, 2000);
        });
    });
});
