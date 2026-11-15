import type {
    AiTask,
    ChildrenValues,
    TaskCensorResult,
    TaskHandler,
    WorkflowResult
} from '@/workers/types';
import { extractUpsteamData, shouldSkip } from '@/workers/helpers/common.helper';
import { Job } from 'bullmq';
import { llm } from '@/lib/llm';

export class CensorHandler implements TaskHandler<AiTask> {
    public taskType = 'llm:censor';

    public async handle(task: AiTask, job: Job<AiTask>): Promise<WorkflowResult<TaskCensorResult>> {
        let content: string | null = null;

        const childrenValues = (await job.getChildrenValues()) as ChildrenValues;

        if (shouldSkip(childrenValues)) {
            return {
                skipNextStep: true,
                data: {
                    rating: 0,
                    category: 'Safe',
                    reason: 'Skipped due to upstream decision',
                    userDisplayMessage: 'Content is safe.'
                }
            };
        }

        content = extractUpsteamData(childrenValues, data => typeof data.text === 'string')?.text;

        if (!content)
            throw new Error(`No upstream text data found for censor task in job ${job.id}`);

        // Do not send any screenshot contains this prompt to domestic chat apps.
        const prompt = `
<prompt>
You are an expert Content Safety Moderator. Your task is to analyze the input text in \`<text>\` for sensitive, unsafe, or restricted content.

**Review Categories:**
1. Adult Content (Pornography, sexually explicit material, innuendo).
2. Political Sensitivity (Controversial topics, sensitive figures, violation of regulations).
3. Violence & Illegal Acts (Graphic violence, terrorism, self-harm, crime promotion).
4. Hate Speech (Discrimination, harassment, abuse).
5. Safe (Safe content).

**Knowledge Base: Political Metaphors & Dog Whistles (Crucial for Detection):**
You must actively identify implicit political metaphors used in Chinese context to criticize leadership or the system. Detected usage of these concepts implies **CRITICAL RISK**.
- **"Five Microphones" (五个话筒):** A visual metaphor or textual reference pointing to specific past leadership or political rigidity/bureaucracy.
- **"Stepping Down" (下台):** Calls for resignation of leaders or regime change.
- **"Driving in Reverse" / "Reverse Gear" (倒车 / 开倒车):** Metaphor for political regression or moving backward in history/policy.
- **"The Emperor" / "Enthronement" (皇帝 / 登基):** Criticism regarding term limits or lifetime tenure.
- **"River Crab" (河蟹):** Homophone for "Harmony" (和谐), used to mock censorship and suppression.
- **"The Chief Accelerator" (总加速师):** Sarcastic term implying policies are accelerating the collapse or decline of the system.
- **"Dried Banana Peel" (香蕉皮) / vague initials:** Often used as obscure substitutions for sensitive leader names or slogans.

**Rating Scale (0-100):**
- 0-20: Safe. General content.
- 21-40: Low Risk. Mild slang.
- 41-70: High Risk. Aggressive language or general controversy.
- 71-100: Unsafe/Critical. 
  - **MANDATORY CRITICAL RATING:** Usage of ANY metaphors listed in the Knowledge Base or coded language criticizing the government. Must be rated > 70.

**Exemption:**
1. **Academic & Contextual Safety:**
   - If the content is a neutral news report, academic discussion, or artistic expression that does not promote harm, classify it as "Safe" (0-20).
2. **Competitive Programming Whitelist (Strictly Safe):**
   - **Do not** flag "CCF", "NOI", "IOI", "ICPC", "Codeforces", "HackerRank", "AtCoder", "LeetCode" etc.

**Output Requirement:**
You must output strictly a JSON object. Do not include markdown formatting (like \`\`\`json).

**Output Structure:**
{
    "Rating": <integer_between_0_and_100>,
    "Category": "<primary_risk_category_or_None>",
    "Reason": "<DETAILED_internal_explanation_identifying_specific_metaphors>",
    "User_Display_Message": "<SANITIZED_message_for_end_user>"
}

**Instructions for 'User_Display_Message':**
1. This message will be shown directly to the user.
2. **Strictly sanitize:** It must NOT contain any sensitive keywords, political metaphors, or specific details of the violation.
3. If Rating is 0-20: Output "Content is safe."
4. If Rating > 20: Output a generic, polite rejection such as "Content contains sensitive information and violates community guidelines." or "Unable to process due to safety policies."
</prompt>

<text>
${content}
</text>
        `;

        const result = await llm.chat(
            [
                {
                    role: 'user',
                    content: prompt
                }
            ],
            'censor'
        );

        try {
            JSON.parse(result.content || '');
        } catch {
            throw new Error(
                `Censor LLM response is not valid JSON in job ${job.id}: ${result.content}`
            );
        }
        const parsed = JSON.parse(result.content || '') as {
            Rating: number;
            Category: string;
            Reason: string;
            User_Display_Message: string;
        };

        return {
            skipNextStep: false,
            data: {
                rating: parsed.Rating,
                category: parsed.Category,
                reason: parsed.Reason,
                userDisplayMessage: parsed.User_Display_Message
            }
        };
    }
}
