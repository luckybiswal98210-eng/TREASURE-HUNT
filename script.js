// 22 Questions (Places Hunt) with correct answers
const questions = [
    { id: 1, question: "When hunger strikes between a class, Or you need a pen that won't let you pass, Snacks and stuff all in one place, Find this shop in the campus space.", answer: "Departmental Store" },
    { id: 2, question: "The temple calls, the bells may ring, But here resides the one who sings. Not the altar, not the dome - Find the priest's quiet home.", answer: "Temple Hut" },
    { id: 3, question: "Find the place where a ball goes over a net using only hands.", answer: "Volleyball Ground" },
    { id: 4, question: "Where engineers pass day by day, A silent pond has found its way. Fish are seen yet never free - Look where water loves to be.", answer: "BTech Fish Fountain" },
    { id: 5, question: "Where power is studied and justice is taught, Rise above both to the place they forgot. No deals are signed, no verdicts spoken - Just sky above and silence unbroken.", answer: "LC-1 Top Floor" },
    { id: 6, question: "No single purpose, yet always full, No doors to close, no crowds to pull. Where sport meets snack and talks run free - Find the campus' open sea.", answer: "Alfresco" },
    { id: 7, question: "No exams are written here, Yet every student must appear. Fees, IDs, or documents in stock, Find the college's control block.", answer: "Admin Block" },
    { id: 8, question: "After knowledge travels far and wide, Its keepers here choose to reside. No timetable rules this place - Find the homes of guiding grace.", answer: "Faculty Quarters" },
    { id: 9, question: "Silence speaks louder than sound, Knowledge is waiting to be found. Before the books line every side, Find the door where minds open wide.", answer: "Library Entrance" },
    { id: 10, question: "Where fun and fests come alive, And student talents always thrive, Near the office that guides your way, A locker quietly waits today.", answer: "Activity Centre (Locker)" },
    { id: 11, question: "Where tools speak louder than words, And practice matters more than awards. Not theory alone, but hands that work, Find the place where skills don't shirk.", answer: "PDR Workshop" },
    { id: 12, question: "Long ears, quick hops, and cotton tail white, I munch on greens from morning till night. I'm not free to roam, I stay in a cage - Find me near food but off the stage.", answer: "Rabbit Cage" },
    { id: 13, question: "Heading for fun or heading to eat, You'll pass a red cube on this street. Big, bold, and hard to ignore - Your next clue waits at its door.", answer: "Red Room" },
    { id: 14, question: "I stand where many paths are curved, Between the halls where food is served. I throw up water, cool and bright - Find me shining in plain sight.", answer: "Mess Fountain" },
    { id: 15, question: "When the sun is hot and games are tight, I bring cold smiles in every bite. Butter, milk and creamy delight, Standing close to the tennis sight.", answer: "Amul" },
    { id: 16, question: "Where dosas crisp and chutneys flow, Long red seats sit row by row. Hungry crowds gather day and night - Find the place of southern delight.", answer: "Ananthahara" },
    { id: 17, question: "Stone supports a silent seat, No net I hold, no bat I swing, Still close enough to hear cheers ring. By HOR-5 I quietly stay - Where tired feet pause on the way.", answer: "Cricket Ground Seating Area" },
    { id: 18, question: "Find the place where business meets law - A tall red sign will guide what you saw. Not a classroom, yet it shows the way, To minds at work both night and day.", answer: "LC-1 Sign Board" },
    { id: 19, question: "When your wallet is empty and hopes are high, Follow the path of fancy stones nearby. To the machine that eats cards and spits notes - Find the spot where money floats.", answer: "ATM" },
    { id: 20, question: "Food and water in name I claim, Seek the tent that shares the same. Beneath the colors overhead, Your next direction waits to be read.", answer: "Dana Pani Tent" },
    { id: 21, question: "Saffron, white, and green held high, Watching quietly as football players pass by. Not part of the game, yet central to all - Find the colors that never fall.", answer: "Football Ground Flag Hosting Area" },
    { id: 22, question: "Tall and wide, I clearly stand - The biggest tree in parking land. While engines sleep beneath my crown, Your next clue waits when you look down.", answer: "Parking Lot Tree" }
];

const FIXED_FIRST_QUESTION_ID = 1;
const FIXED_LAST_QUESTION_ID = 5;
let orderedQuestions = [];

let currentQuestionIndex = 0;
let formData = [];
let teamId = '1';
let teamName = 'Team';

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    try {
        // Get team from sessionStorage
        const storedTeam = sessionStorage.getItem('teamId');
        const storedTeamName = sessionStorage.getItem('teamName');
        
        if (storedTeam) {
            teamId = String(storedTeam);
            if (storedTeamName) {
                teamName = storedTeamName;
                document.getElementById('teamName').textContent = teamName;
            }
            document.getElementById('teamNumber').textContent = teamId;
        }
        
        // Build question order for this team
        shuffleQuestions();
        
        // Setup listeners
        document.getElementById('cameraBtn').addEventListener('click', openCamera);
        document.getElementById('photoUpload').addEventListener('change', handlePhotoUpload);
        document.getElementById('validateBtn').addEventListener('click', validateAnswer);
        document.getElementById('resetBtn').addEventListener('click', resetForm);
        document.getElementById('answerBox').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') validateAnswer();
        });
        
        // Load first question
        loadQuestion();
        console.log('✓ Initialized for Team ' + teamId);
    } catch (error) {
        console.error('ERROR:', error);
        alert('Error loading page');
    }
});

// Shuffle questions
function shuffleQuestions() {
    const firstQuestion = questions.find((q) => q.id === FIXED_FIRST_QUESTION_ID);
    const lastQuestion = questions.find((q) => q.id === FIXED_LAST_QUESTION_ID);

    const middleQuestions = questions.filter(
        (q) => q.id !== FIXED_FIRST_QUESTION_ID && q.id !== FIXED_LAST_QUESTION_ID
    );

    const seed = parseInt(teamId, 10) * 12345;
    for (let i = middleQuestions.length - 1; i > 0; i--) {
        const j = Math.abs((seed + i) * 9973) % (i + 1);
        [middleQuestions[i], middleQuestions[j]] = [middleQuestions[j], middleQuestions[i]];
    }

    orderedQuestions = [firstQuestion, ...middleQuestions, lastQuestion].filter(Boolean);
}

// Load question
function loadQuestion() {
    const q = orderedQuestions[currentQuestionIndex];
    document.getElementById('questionTitle').textContent = 'Question ' + q.id;
    document.getElementById('questionText').textContent = q.question;
    
    // Clear answer box
    const answerBox = document.getElementById('answerBox');
    answerBox.value = '';
    
    // Clear photo upload
    const photoUpload = document.getElementById('photoUpload');
    photoUpload.value = null;
    photoUpload.type = 'file';
    
    // Clear preview
    document.getElementById('photoPreview').innerHTML = '';
    document.getElementById('validationMessage').innerHTML = '';
    
    const progress = ((currentQuestionIndex + 1) / orderedQuestions.length) * 100;
    document.getElementById('progressFill').style.width = progress + '%';
}

// Open camera
function openCamera() {
    document.getElementById('photoUpload').click();
}

// Handle photo
function handlePhotoUpload() {
    const file = document.getElementById('photoUpload').files[0];
    const preview = document.getElementById('photoPreview');
    
    if (!file) {
        preview.innerHTML = '';
        return;
    }
    
    const reader = new FileReader();
    reader.onload = (e) => {
        preview.innerHTML = `
            <div style="text-align: center; padding: 10px; background: #f0f2ff; border-radius: 8px;">
                <img src="${e.target.result}" alt="Photo" style="max-width: 100%; height: 150px; object-fit: cover; border-radius: 8px; margin-bottom: 10px;">
                <p style="color: #667eea; font-size: 12px; margin: 0;">✓ Photo captured</p>
            </div>
        `;
    };
    reader.readAsDataURL(file);
}

function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => resolve(event.target.result);
        reader.onerror = () => reject(new Error('Failed to read photo'));
        reader.readAsDataURL(file);
    });
}

function normalizeForStrictMatch(value) {
    return String(value || '')
        .toLowerCase()
        .trim()
        .replace(/\s+/g, ' ');
}

async function saveResponseToServer(currentQuestion, answer, photo) {
    const photoDataUrl = await fileToDataUrl(photo);
    const payload = {
        teamId: teamId,
        teamName: teamName,
        questionId: currentQuestion.id,
        question: currentQuestion.question,
        answer: answer,
        isCorrect: true,
        photoName: photo.name,
        photoDataUrl: photoDataUrl,
        timestamp: new Date().toLocaleTimeString()
    };

    const response = await fetch('/api/submissions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        throw new Error('Server failed to save response');
    }

    const result = await response.json();
    return result.record;
}

// Validate
async function validateAnswer() {
    const answer = document.getElementById('answerBox').value.trim();
    const photo = document.getElementById('photoUpload').files[0];
    const msg = document.getElementById('validationMessage');
    const validateBtn = document.getElementById('validateBtn');
    
    if (!answer) {
        msg.innerHTML = '❌ Enter place name!';
        msg.className = 'validation-message show error';
        return;
    }
    
    if (!photo) {
        msg.innerHTML = '❌ Take photo first!';
        msg.className = 'validation-message show error';
        return;
    }
    
    const currentQuestion = orderedQuestions[currentQuestionIndex];
    const correct = currentQuestion.answer;
    const isCorrect = normalizeForStrictMatch(answer) === normalizeForStrictMatch(correct);
    
    if (isCorrect) {
        try {
            validateBtn.disabled = true;
            validateBtn.textContent = 'Saving...';
            msg.innerHTML = '✓ Correct! Saving response...';
            msg.className = 'validation-message show success';

            const savedRecord = await saveResponseToServer(currentQuestion, answer, photo);

            formData.push({
                questionId: currentQuestion.id,
                question: currentQuestion.question,
                answer: answer,
                isCorrect: true,
                photo: photo.name,
                savedPhotoPath: savedRecord.photoPath,
                timestamp: new Date().toLocaleTimeString()
            });

            msg.innerHTML = '✓ Correct! Saved successfully.';

            setTimeout(() => {
                currentQuestionIndex++;
                if (currentQuestionIndex < orderedQuestions.length) {
                    loadQuestion();
                } else {
                    showSummary();
                }
            }, 1200);
        } catch (error) {
            msg.innerHTML = '❌ Correct answer, but save failed. Please retry.';
            msg.className = 'validation-message show error';
        } finally {
            validateBtn.disabled = false;
            validateBtn.textContent = '✓ Check Answer';
        }
    } else {
        msg.innerHTML = '✗ Try again!';
        msg.className = 'validation-message show error';
    }
}

// Summary
function showSummary() {
    document.getElementById('questionForm').style.display = 'none';
    document.querySelector('.question-section').style.display = 'none';
    document.getElementById('summarySection').style.display = 'block';
    
    const correct = formData.filter(x => x.isCorrect).length;
    const score = Math.round((correct / formData.length) * 100);
    
    let html = `<div style="padding: 15px; background: #f0f2ff; border-radius: 8px; margin-bottom: 20px;">
        <p><strong>Total:</strong> ${formData.length}</p>
        <p><strong>Correct:</strong> ${correct}</p>
        <p><strong>Score:</strong> ${score}%</p>
    </div>`;
    
    formData.forEach(item => {
        html += `<div class="summary-item">
            <strong>Q${item.questionId}:</strong> ${item.question}<br>
            Answer: ${item.answer}<br>
            ${item.isCorrect ? '✓ Correct' : '✗ Wrong'} | 📷 ${item.photo}
        </div>`;
    });
    
    document.getElementById('summaryContent').innerHTML = html;
}

// Reset
function resetForm() {
    currentQuestionIndex = 0;
    formData = [];
    shuffleQuestions();
    
    document.getElementById('questionForm').style.display = 'block';
    document.querySelector('.question-section').style.display = 'block';
    document.getElementById('summarySection').style.display = 'none';
    
    loadQuestion();
}
