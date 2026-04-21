export const INTENT_PAGE_ORDER = [
  '/ai-resume-screening',
  '/bulk-resume-analysis',
  '/resume-scoring-ai',
  '/automated-candidate-shortlisting',
]

export const INTENT_PAGE_CONTENT = {
  '/ai-resume-screening': {
    h1: 'AI Resume Screening for Faster, Fairer Hiring Decisions',
    hero: 'Move from resume overload to shortlist-ready in minutes. HireFlow helps recruiting teams review applicants consistently, reduce manual screening time, and focus on the people most likely to succeed in the role.',
    ctaLabel: 'Book a live demo',
    paragraphs: [
      'When every open role brings in dozens or hundreds of applicants, most teams face the same bottleneck: first-pass resume review. It is slow, repetitive, and hard to scale without sacrificing consistency. AI resume screening solves that first bottleneck by structuring candidate information, matching it against role criteria, and giving your team a clear ranking framework so you can move quickly without skipping strong talent.',
      'HireFlow is built for recruiters and hiring managers who need confidence, not just speed. Instead of replacing your judgment, it standardizes the heavy lifting so your team can spend more time on interviews, calibration, and candidate experience. You define what matters for each job: core skills, years of experience, industry context, technical signals, communication indicators, and role-specific requirements. The platform then screens incoming resumes against that profile and provides transparent scoring outputs your team can review together.',
      'The business impact is straightforward. Teams using AI resume screening typically reduce time spent in the top of funnel, improve handoff quality between recruiters and hiring managers, and decrease the number of missed high-potential candidates caused by manual fatigue. When your screening process is consistent and repeatable, downstream metrics improve: faster time-to-shortlist, fewer late-stage mismatches, and stronger offer conversion because your interviews start with better-aligned candidates.',
      'For talent leaders, consistency matters as much as speed. Manual screening can drift from reviewer to reviewer, especially when requisitions are urgent. HireFlow applies the same framework to every applicant for a given role, then makes the reasoning visible so teams can calibrate together. This creates a more defensible process and helps organizations improve hiring quality over time because each role can be tuned with feedback from real outcomes.',
      'Implementation is lightweight. Upload resumes directly, analyze them in bulk, and prioritize candidates with clear match summaries. You can review recommendations, adjust criteria, and export or share results with stakeholders. Whether you are hiring for one critical role or coordinating multiple openings across departments, the workflow stays simple: define criteria, screen fast, review intelligently, and move qualified people forward earlier.',
      'If your team is currently spending hours on first-round filtering, this is where you reclaim capacity. AI resume screening helps you focus on higher-value recruiting work while creating a more structured and candidate-friendly process. Start with one role, measure shortlist velocity and interview-to-offer quality, then roll it out across your pipeline once you see the lift.',
    ],
    personaPainPoints: [
      {
        title: 'Recruiters overloaded with first-pass review',
        copy: 'Reduce repetitive resume triage so recruiters can focus on outreach, interviews, and stakeholder coordination.',
      },
      {
        title: 'Hiring managers getting inconsistent shortlists',
        copy: 'Use shared role criteria so each reviewer evaluates candidates against the same standards.',
      },
      {
        title: 'Talent leaders pressured to improve speed and quality',
        copy: 'Create a repeatable intake-to-shortlist system that improves throughput without lowering hiring quality.',
      },
    ],
    outcomes: [
      {
        title: 'Faster time to shortlist',
        copy: 'Teams can move qualified candidates to interviews sooner and reduce backlog in top-of-funnel stages.',
      },
      {
        title: 'Higher shortlist confidence',
        copy: 'Explainable score rationale helps recruiting teams defend who advances and why.',
      },
      {
        title: 'Better operational consistency',
        copy: 'A standardized screening workflow reduces reviewer drift and improves handoffs across teams.',
      },
    ],
    faqs: [
      {
        q: 'How accurate is AI resume screening for specialized roles?',
        a: 'Accuracy improves when role criteria are explicit. HireFlow lets you define must-have and preferred signals, then refine scoring with recruiter feedback so specialized hiring stays aligned with team expectations.',
      },
      {
        q: 'Can we review why a candidate was scored higher or lower?',
        a: 'Yes. Candidate summaries are designed to be explainable so recruiters and hiring managers can understand fit signals and use them in calibration discussions.',
      },
      {
        q: 'Does AI resume screening replace recruiters?',
        a: 'No. It accelerates first-pass analysis so recruiters can spend more time on interviewing, stakeholder alignment, and candidate engagement.',
      },
    ],
  },
  '/bulk-resume-analysis': {
    h1: 'Bulk Resume Analysis for High-Volume Hiring Teams',
    hero: 'Analyze large resume batches without losing quality. HireFlow helps recruiting operations teams process high applicant volume with structured scoring, fast triage, and clear collaboration across hiring stakeholders.',
    ctaLabel: 'Start your demo workflow',
    paragraphs: [
      'High-volume recruiting creates a familiar problem: your team receives more resumes than it can consistently evaluate within SLA. Manual review queues grow, strong candidates wait too long, and recruiters are forced to triage quickly with limited context. Bulk resume analysis gives talent teams a scalable way to process large applicant pools while keeping decision quality and fairness intact.',
      'HireFlow is designed to turn big resume batches into prioritized pipelines. Instead of opening one file at a time and making ad hoc judgments, your team can upload and analyze candidates in bulk, apply role-specific criteria, and instantly see ranked outputs that make next steps obvious. Recruiters can quickly identify top-fit candidates, separate borderline profiles for secondary review, and archive low-fit applicants with confidence.',
      'For operations leaders, the value is predictable throughput. Bulk analysis reduces the manual effort required to move from application intake to qualified shortlist. It also helps standardize handoffs across recruiting coordinators, sourcers, and hiring managers because everyone is looking at the same structured signal set. This reduces rework, speeds alignment meetings, and minimizes the back-and-forth that usually slows high-volume hiring cycles.',
      'A strong bulk analysis process is not only about speed. It also helps improve candidate experience. When your team can review applicants faster, qualified candidates receive responses sooner and are less likely to accept competing offers. Faster triage also allows recruiters to proactively communicate timelines and keep candidates warm rather than going silent during resume backlog periods.',
      'HireFlow supports practical rollout for teams hiring across multiple roles at once. You can run separate scoring profiles by job family, compare outcomes across requisitions, and monitor which criteria are too broad or too strict. Over time, this creates a feedback loop: recruiters learn which inputs correlate with successful interviews and on-the-job performance, then tune the model-assisted process to improve quality with each hiring cycle.',
      'If your recruiting team is dealing with seasonal spikes, campus hiring, support roles, sales expansion, or any other high-volume scenario, bulk resume analysis provides immediate leverage. You keep humans in control of final decisions while automating repetitive initial review work. The result is a faster, cleaner funnel that helps your team hit hiring targets without burning out your recruiters.',
    ],
    personaPainPoints: [
      {
        title: 'Ops teams missing SLAs during hiring spikes',
        copy: 'Batch analysis keeps screening throughput predictable when resume volume rises suddenly.',
      },
      {
        title: 'Recruiters manually sorting massive applicant pools',
        copy: 'Prioritized rankings help teams identify top-fit candidates without opening every file one by one.',
      },
      {
        title: 'Department leaders waiting on candidate handoffs',
        copy: 'Structured outputs reduce handoff delays between recruiting coordinators and hiring managers.',
      },
    ],
    outcomes: [
      {
        title: 'Higher recruiter capacity',
        copy: 'Teams process more applications per recruiter without sacrificing role-specific evaluation quality.',
      },
      {
        title: 'Improved candidate response times',
        copy: 'Faster triage means qualified applicants receive updates before they drop out or accept other offers.',
      },
      {
        title: 'Cleaner pipeline collaboration',
        copy: 'Shared ranking signals reduce rework and make review meetings faster and more aligned.',
      },
    ],
    faqs: [
      {
        q: 'How many resumes can we analyze in one batch?',
        a: 'HireFlow is built for batch workflows and can process large uploads quickly so teams can keep pace with high-volume applicant inflow.',
      },
      {
        q: 'Can different roles use different scoring criteria?',
        a: 'Yes. You can apply role-specific frameworks so customer support, engineering, sales, and operations openings are evaluated against distinct requirements.',
      },
      {
        q: 'Is bulk resume analysis useful for staffing agencies?',
        a: 'Absolutely. Agencies can use bulk analysis to accelerate first-pass qualification and deliver stronger shortlists to clients faster.',
      },
    ],
  },
  '/resume-scoring-ai': {
    h1: 'Resume Scoring AI That Helps Teams Prioritize the Right Candidates',
    hero: 'Replace gut-feel ranking with a repeatable scoring system. HireFlow turns resume review into transparent candidate prioritization so recruiters and hiring managers can align faster and interview with confidence.',
    ctaLabel: 'See scoring in action',
    paragraphs: [
      'Most hiring teams do not struggle to find candidates; they struggle to prioritize them correctly at speed. Resume scoring AI addresses that gap by converting unstructured profile data into a clear, role-based scoring framework. Instead of inconsistent first impressions, your team gets a repeatable method for identifying fit signals and deciding who should move forward first.',
      'HireFlow’s scoring approach is built around recruiter usability. You define the profile that matters for the role and the platform evaluates each resume against that profile, producing practical outputs your team can use immediately. Candidate summaries surface strengths, potential gaps, and relevant context so decisions are faster and easier to explain to hiring managers.',
      'Scoring clarity improves collaboration. Recruiters, coordinators, and hiring managers frequently disagree in early funnel stages because they are using different mental models. A shared scoring view gives everyone a common language for discussing candidate quality. That means fewer calibration meetings, less re-evaluation of the same resumes, and quicker agreement on interview slates.',
      'AI scoring also improves process hygiene. Without a structured approach, urgent hiring often leads to uneven screening and late-stage surprises. With a consistent scoring layer, teams can catch mismatch signals early, reserve interview time for stronger matches, and continuously refine criteria based on outcomes. Over time, this drives better interview efficiency and stronger hiring signal quality.',
      'From a leadership perspective, resume scoring AI helps create a measurable top-of-funnel system. You can benchmark how quickly candidates move from application to shortlist, evaluate pass-through rates by score bands, and identify where criteria tuning is needed. This makes hiring less reactive and more operationally disciplined, especially when multiple teams are hiring concurrently.',
      'If your team wants to make faster decisions without sacrificing judgment, AI scoring is the practical midpoint between fully manual review and opaque automation. HireFlow keeps people in the decision loop while removing low-leverage work. Start with one role, calibrate scores with your hiring manager, and scale once your team has a scoring model it trusts.',
    ],
    personaPainPoints: [
      {
        title: 'Recruiters using inconsistent ranking logic',
        copy: 'Role-based scoring creates a shared rubric so prioritization is repeatable across reviewers.',
      },
      {
        title: 'Hiring managers disagreeing on candidate quality',
        copy: 'Transparent candidate summaries make calibration conversations faster and more objective.',
      },
      {
        title: 'Leadership lacking measurable screening standards',
        copy: 'Track pass-through performance by score band to refine criteria and improve forecasting.',
      },
    ],
    outcomes: [
      {
        title: 'Faster recruiter-manager alignment',
        copy: 'Shared score rationale cuts duplicate reviews and shortens early-stage decision cycles.',
      },
      {
        title: 'More defensible interview slates',
        copy: 'Candidates are advanced using explicit criteria instead of ad hoc first impressions.',
      },
      {
        title: 'Continuous scoring improvement',
        copy: 'Teams can tune weights over time using interview outcomes and hiring manager feedback.',
      },
    ],
    faqs: [
      {
        q: 'What does resume scoring AI look at?',
        a: 'It evaluates role-relevant factors such as skills, experience alignment, and context signals based on the criteria you define for each requisition.',
      },
      {
        q: 'Can we adjust scoring after reviewing candidates?',
        a: 'Yes. Teams can iterate on scoring priorities as they learn from interview outcomes and hiring manager feedback.',
      },
      {
        q: 'Will scoring AI work for both technical and non-technical roles?',
        a: 'Yes. The framework can be customized for engineering, go-to-market, operations, and other role families.',
      },
    ],
  },
  '/automated-candidate-shortlisting': {
    h1: 'Automated Candidate Shortlisting for Lean Recruiting Teams',
    hero: 'Build high-quality interview slates faster. HireFlow automates the shortlist creation process so your team can move from applications to recruiter-ready candidate lists with less manual effort and better consistency.',
    ctaLabel: 'Book a shortlisting demo',
    paragraphs: [
      'Creating shortlists is where recruiting speed and hiring quality either come together or break apart. When shortlisting is manual, teams lose time reviewing low-fit applications and often revisit the same profiles repeatedly. Automated candidate shortlisting helps teams move from raw applicant volume to interview-ready lists quickly, while preserving recruiter oversight and decision quality.',
      'HireFlow streamlines shortlisting by combining role-based analysis, candidate scoring, and ranked outputs that make prioritization simple. Recruiters can immediately see which candidates meet core requirements, which are promising but need closer review, and which should be removed from the active funnel. This structure removes guesswork and helps teams stay focused on candidates with the highest potential impact.',
      'For growing companies, shortlisting automation creates leverage without adding headcount. A single recruiter can manage more requisitions because first-pass filtering becomes systematic instead of manual. Hiring managers also benefit: they receive cleaner slates with clearer context, which shortens review cycles and increases confidence in interview plans.',
      'Automation also supports fairness and consistency. Different reviewers naturally use different heuristics, especially under deadline pressure. By applying a consistent shortlist framework to all applicants for a role, your team reduces process drift and creates a more defensible hiring workflow. Recruiters can still override recommendations, but they start from a common baseline that improves alignment.',
      'Operationally, automated shortlisting improves funnel health. Teams can reduce time-to-first-touch for qualified candidates, prevent top talent from stalling in backlog, and create faster feedback loops between recruiting and hiring managers. Over multiple hiring cycles, this usually translates into better conversion rates because interviews are focused on stronger candidate pools earlier in the process.',
      'If your recruiting team is balancing speed, quality, and limited capacity, automated shortlisting is one of the highest-leverage upgrades you can make. HireFlow helps you launch quickly, test on active requisitions, and scale across departments once you confirm the process fit. The outcome is a more predictable hiring system that supports both immediate goals and long-term talent quality.',
    ],
    personaPainPoints: [
      {
        title: 'Lean recruiting teams handling too many reqs',
        copy: 'Automated shortlisting reduces first-pass load so one recruiter can manage more openings confidently.',
      },
      {
        title: 'Managers spending time on low-fit profiles',
        copy: 'Ranked candidate lists surface likely interview matches before manager review begins.',
      },
      {
        title: 'Teams struggling with process drift under deadlines',
        copy: 'Consistent shortlist criteria keeps evaluation quality stable even during urgent hiring periods.',
      },
    ],
    outcomes: [
      {
        title: 'Shorter application-to-interview cycle',
        copy: 'Qualified candidates are identified and advanced sooner across active requisitions.',
      },
      {
        title: 'Higher interview efficiency',
        copy: 'Managers spend panel time on stronger matches instead of weakly aligned applicants.',
      },
      {
        title: 'More predictable hiring operations',
        copy: 'Repeatable shortlisting improves planning, funnel visibility, and cross-team accountability.',
      },
    ],
    faqs: [
      {
        q: 'How is automated shortlisting different from simple keyword filtering?',
        a: 'Shortlisting uses multi-signal role alignment, not just keyword matches, so teams get a higher-quality candidate ranking baseline.',
      },
      {
        q: 'Can recruiters override shortlisted candidates?',
        a: 'Yes. Recruiters remain in control and can review, adjust, and approve shortlists before interviews are scheduled.',
      },
      {
        q: 'Is this helpful for early-stage teams with one recruiter?',
        a: 'Yes. Lean teams gain significant capacity because shortlist generation becomes faster and more repeatable across roles.',
      },
    ],
  },
}

export function getIntentPage(pathname) {
  return INTENT_PAGE_CONTENT[pathname] || null
}
