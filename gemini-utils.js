const { GoogleGenerativeAI } = require('@google/generative-ai');

/**
 * Gemini API utility class for interacting with Google's generative models.
 */
class GeminiService {
    constructor() {
        this.apiKey = process.env.GOOGLE_API_KEY;
        if (!this.apiKey) {
            console.warn('ℹ️  GOOGLE_API_KEY가 없습니다. .env에 설정하면 Gemini AI 기능을 사용할 수 있습니다.');
        }
        this.genAI = new GoogleGenerativeAI(this.apiKey);
        // Use gemini-2.0-flash which is available for this API key
        this.model = this.genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    }

    /**
     * Generates a text response for a given prompt.
     * @param {string} prompt - The prompt to send to the model.
     * @returns {Promise<string>} - The generated text response.
     */
    async generateResponse(prompt) {
        if (!this.apiKey) {
            return 'API key is missing. Please check your environment variables.';
        }

        try {
            const result = await this.model.generateContent(prompt);
            const response = await result.response;
            const text = response.text();
            return text;
        } catch (error) {
            console.error('Error generating response from Gemini:', error);
            if (error.status === 404) {
                return '모델을 찾을 수 없습니다 (404). 모델 설정을 확인해주세요.';
            }
            return 'An error occurred while generating a response.';
        }
    }
}

module.exports = new GeminiService();

