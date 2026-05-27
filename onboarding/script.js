document.addEventListener('DOMContentLoaded', () => {
    const panels = document.querySelectorAll('.step-panel');
    const stepIndicators = document.querySelectorAll('.step-indicator');
    const demoBtns = document.querySelectorAll('.demo-btn');
    
    const parentPhoneInput = document.getElementById('parent-phone');
    const btnAuthenticate = document.getElementById('btn-authenticate');
    const btnFinish = document.getElementById('btn-finish');
    const successPhone = document.getElementById('success-phone');

    let currentStep = 1;
    let authTimeout = null;

    function goToStep(stepNum) {
        if (stepNum < 1 || stepNum > 3) return;
        currentStep = stepNum;

        // Update active panel
        panels.forEach((panel, idx) => {
            if (idx + 1 === stepNum) {
                panel.classList.add('active');
            } else {
                panel.classList.remove('active');
            }
        });

        // Update stepper indicators
        stepIndicators.forEach((indicator) => {
            const indStep = parseInt(indicator.getAttribute('data-target'));
            if (indStep === stepNum) {
                indicator.className = 'step-indicator active';
            } else if (indStep < stepNum) {
                indicator.className = 'step-indicator completed';
            } else {
                indicator.className = 'step-indicator';
            }
        });

        // Update demo controller buttons
        demoBtns.forEach(btn => {
            if (parseInt(btn.getAttribute('data-step')) === stepNum) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        // Cancel simulated loading if navigating away
        if (stepNum !== 2) {
            clearTimeout(authTimeout);
        }

        // Fill in the authenticated phone number
        if (stepNum === 3) {
            successPhone.textContent = parentPhoneInput.value || '+1 (555) 000-0000';
        }
    }

    // Direct click navigation for screenshots
    stepIndicators.forEach(indicator => {
        indicator.addEventListener('click', () => {
            goToStep(parseInt(indicator.getAttribute('data-target')));
        });
    });

    demoBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            goToStep(parseInt(btn.getAttribute('data-step')));
        });
    });

    // Step 1: Trigger Authentication
    btnAuthenticate.addEventListener('click', () => {
        const phoneVal = parentPhoneInput.value.trim();
        if (!phoneVal) {
            parentPhoneInput.classList.add('error-pulse');
            setTimeout(() => parentPhoneInput.classList.remove('error-pulse'), 1000);
            parentPhoneInput.focus();
            return;
        }

        // Go to Screen 2
        goToStep(2);

        // Simulate network request
        authTimeout = setTimeout(() => {
            if (currentStep === 2) { 
                goToStep(3); // Auto transition to Screen 3
            }
        }, 2000); // 2 second delay
    });

    // Step 3: Finish Reset
    btnFinish.addEventListener('click', () => {
        alert('Authentication flow completed! Screens are ready for your slides.');
        goToStep(1);
        parentPhoneInput.value = '';
    });
});
