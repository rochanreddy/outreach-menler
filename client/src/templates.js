/**
 * Ready-to-send sequences, so a new campaign is never a blank box.
 *
 * Rules these follow, because they're what keeps cold mail out of spam:
 *  - Plain text, short. Anything that reads like a newsletter gets filtered.
 *  - One ask, and a low-commitment one ("worth a reply?" beats "book a call").
 *  - No sign-off name — the server appends OUTREACH_SIGNATURE and the
 *    unsubscribe footer to every send. Adding one here would duplicate it.
 *  - Every {{placeholder}} carries a fallback, so a contact with a missing
 *    first name reads "Hi there," and not "Hi ,".
 */

export const TEMPLATES = [
  {
    id: 'workshop',
    label: 'AI workshop',
    blurb: 'Offers a hands-on session for students. Best for TPOs and HODs.',
    steps: [
      {
        subject: 'AI workshop for {{college|your}} students',
        body: `Hi {{first_name|there}},

I'm reaching out from Menler — we run hands-on AI sessions for engineering students.

Most students today have used ChatGPT, but very few can actually build with AI. We close that gap in a single day: students leave having built and deployed something real, not having sat through slides.

We've run this with colleges across {{state|India}}, and it works as a standalone workshop or as part of your existing training calendar.

Would it be worth a short call to see if this fits {{college|your college}} this semester?

Thanks,`,
        delayDays: 0,
        threaded: true,
      },
      {
        subject: 'Re: AI workshop for {{college|your}} students',
        body: `Hi {{first_name|there}},

Just floating this back to the top of your inbox in case it got buried.

Happy to send a one-page outline of what students build in the session — no call needed, just reply "send it" and it's on its way.

Thanks,`,
        delayDays: 4,
        threaded: true,
      },
      {
        subject: 'Re: AI workshop for {{college|your}} students',
        body: `Hi {{first_name|there}},

I'll stop here so I'm not cluttering your inbox.

If AI training isn't a priority for {{college|your college}} right now, no problem at all — and if there's someone else who handles this, I'd be glad to be pointed their way.

Thanks for your time,`,
        delayDays: 6,
        threaded: true,
      },
    ],
  },

  {
    id: 'placement',
    label: 'Placement / employability',
    blurb: 'Leads with placement outcomes. Best for placement officers and principals.',
    steps: [
      {
        subject: 'Helping {{college|your}} students clear AI-role interviews',
        body: `Hi {{first_name|there}},

Quick question for you as {{designation|the placement team}} at {{college|your college}}.

Recruiters have started screening for practical AI skills — not just "do you know Python", but can you build with an LLM API, ship something, and explain your choices. Most students can't answer that yet, and it's showing up in interview rejections.

We train students on exactly that, in a format built around your placement calendar rather than replacing it.

Open to a 15-minute call to see whether it's useful for your outgoing batch?

Thanks,`,
        delayDays: 0,
        threaded: true,
      },
      {
        subject: 'Re: Helping {{college|your}} students clear AI-role interviews',
        body: `Hi {{first_name|there}},

Following up on the note below.

If it's easier, I can send over what we cover and the results from a recent batch — reply "send it" and I'll share it, no call required.

Thanks,`,
        delayDays: 4,
        threaded: true,
      },
      {
        subject: 'Re: Helping {{college|your}} students clear AI-role interviews',
        body: `Hi {{first_name|there}},

Last note from me on this.

If the timing isn't right, I completely understand — happy to check back next placement season instead. And if someone else owns this at {{college|your college}}, do point me their way.

Thanks for your time,`,
        delayDays: 6,
        threaded: true,
      },
    ],
  },

  {
    id: 'faculty',
    label: 'Faculty development',
    blurb: 'An FDP angle for faculty and department heads. Best for HODs and deans.',
    steps: [
      {
        subject: 'AI faculty development programme — {{college|your college}}',
        body: `Hi {{first_name|there}},

I'm writing from Menler about a faculty development programme on AI tools for teaching and research.

The idea is simple: rather than faculty learning AI second-hand from students, we run a short practical programme covering what these tools do well, where they fail, and how to use them in coursework and evaluation without losing academic rigour.

It runs over two days and can be delivered on campus or online.

Would this be of interest to your department this term?

Thanks,`,
        delayDays: 0,
        threaded: true,
      },
      {
        subject: 'Re: AI faculty development programme — {{college|your college}}',
        body: `Hi {{first_name|there}},

Circling back on this in case it slipped past.

I can share the session-by-session breakdown if that's easier to review than a call — just reply and I'll send it across.

Thanks,`,
        delayDays: 5,
        threaded: true,
      },
    ],
  },
];

export const DEFAULT_TEMPLATE = TEMPLATES[0];

/** A fresh copy — templates are shared objects, so never hand out the original. */
export const stepsFrom = (t) => t.steps.map((s) => ({ ...s }));
