i have created this check the attached github repo and latest commit and its working fine but there is a bit of a problem see my chat with GPT tell me how to do this : "

Yesterday 7:14 PM
my talks :
bro i sold my shyt and i earn fine money and now im moving to something big so i build this : https://oath-phi.vercel.app/
or git : Aryan-Protein-Vala/Oath
can you please go through them and create me the legal pages bcz we are here dealing with money and i definitely would get it viewed through by a lawyer but till then so that i can launch it just tomorrow create the all legal pages that this app should have right??
and the only competition is https://www.forfeit.app/ where we are winning bcz that dumbass is making ppl pay 1500+/month to just access the app whereas ours is free and with all feature what a noob he is asking for a subscription + if someone fails they are also losing money or smthg there wtf!!! so wtvr it is the thing is this is what im thinking of doing and it can become smthg good in this AI era everyone is getting lazier than before none is doing the work and this is a good timing to start this
I've got what I need. Before I write anything, you should know a few things from the code that matter more than the legal pages. I'll put them right after the files.
All six legal pages plus a shared layout and config file are done and written for Next.js App Router. The pages are Terms of Service, Privacy Policy, Stakes/Payouts/Refunds, Acceptable Use, Risk Disclosure, and a Notice for Recipients. I'm not a lawyer, so these are solid templates for your lawyer to review, not finished legal documents.
To use them:
Copy the src/ contents into your repo.
Fill in legalConfig.ts once (name, address, emails, grievance officer, payment processor). Every page reads from it, and anything still in [BRACKETS] needs your input.
Add <LegalFooterLinks /> to your footer.
Add <ConsentCheckbox /> to signup and block signup until it's ticked.
Search the files for LAWYER: and you'll find the exact spots I'd want a lawyer to look at.
I tailored these to your schema: the data you collect, the house cut range, social ransom, the Wall of Shame, and the nominee flow. Beyond the pages, the code raised these issues:
Your wallet is simulated. The schema calls it a "Simulated Fiat Ledger" and I saw no payment gateway. If that's still true, launching tomorrow with no real deposits is much safer. The pages assume real money, so if you launch simulated, say so plainly on the site.
The database security has holes that matter once real money is involved:
wallets allows users to update their own row, so someone can edit their balance from the browser.
transactions lets users insert their own ledger entries.
nominees has OR true on read and USING (true) on update. Anyone can read nominee phone numbers and emails and change verdicts.
Any squad member can update an oath, and that can trigger a payout.
NEXT_PUBLIC_ADMIN_PASSWORD in your README gets shipped to every visitor's browser.
Fix these before you let real users near real money.
Winner-takes-all pools are the legal risk, not the missing pages. Duo Duels and Squad Pools, where winners collect losers' stakes, can look like gambling or an online money game. As I understand it, India passed a law in 2025 restricting online money games. Verify this with your lawyer. Holding user funds also brings payments regulation into play. It's worth finding out why Forfeit charges a subscription. It may be structured that way for legal reasons. A safer launch is solo oaths only, with pools switched off.
Social ransom messages go to people who never agreed. I added an opt-out page and a suppression list, but you need to build that suppression check in the code. SMS in India also needs DLT registration. Consider blocking the "physical_debt" and "mutual_destruction" consequence types, since my Acceptable Use page bans harm-based consequences.
Questions to bring to your lawyer:

Are pools and duels permitted, and in which states?
Do you need a licence to hold user funds, or should a payment partner hold them in escrow?
Is the social ransom feature defensible?
Does the anti-charity donation flow create any issues?
Legalconfig

TS 
Legalpage
Code·TSX 
Page
Code·TSX 
Page
Code·TSX 
Page
Code·TSX 
Page
Code·TSX 
Page
Code·TSX 
Page
Code·TSX 
so how to turn this completely legal even with all the pools challenges in duo or squad?? bcz some ppl play with words, we can do smthg too right bcz this is not a gambling app right so there must be a way true??
Short answer: no, wordplay won't get you there. Regulators and courts look at what actually happens to the money, not what you call the app. And I checked, because the law changed recently.
India's Online Gaming Act was passed in August 2025 and its rules took effect on 1 May 2026. The Act bans online money games outright, whether they're skill, chance, or a mix, and it bans advertising and facilitating them. Banks and payment systems are barred from processing transactions linked to them. A law firm's note on the rules says the old skill-versus-chance argument matters much less now for games with monetary staking. What matters is how value enters, moves through, and leaves the game. One source also says the criminal penalties target operators, advertisers and payment facilitators, not people who simply play. That means you, and the payment processor you'd depend on. How India’s 2025 Online Gaming Act Redrew the Line Between Esports, Social Games, and Money Games | FinancialContent +3svg
Squad Pools and Duo Duels, where you deposit money, lose it, and other users collect it, fit that description almost exactly. "It's a commitment tool" won't hold up if a regulator or your payment processor looks at the flow. Your own README and schema also work against you: "House cut", "winner takes all", "house_cut" and "the house always wins" are gambling vocabulary. Change them, but only because the product should actually change. Renaming alone doesn't help. Also, the Act is reportedly being challenged in court, so this could shift, but don't build your launch on that.
Here is what people building commitment apps can do that isn't just relabelling.
Never let one user's loss become another user's gain. This is the big one. Keep solo oaths where you get your stake back on success. On failure, the money goes to a charity or a cause, not to other players and not to a pot. Duo and squad still work as accountability (shared goals, streaks, leaderboards), but nobody profits from a friend's failure. Stake-and-refund commitment apps abroad use this model.
Make pools non-monetary. In squads and duels, the stakes are reputation, points, streaks, and social ransom. Money only appears in solo mode.
Charge for the service, not from the stakes. This may be why Forfeit uses a subscription. I haven't verified their reasons, but revenue from a fee is very different from revenue from people's losses. Your free model, where you keep 5–15% of forfeited stakes, looks more like a gaming operator's. You might be underrating your competitor here.
Keep the money away from you. Use a licensed partner to hold funds in escrow. Payment processors will also do their own review and may refuse you.
Get a written opinion from an Indian gaming/fintech lawyer. Ask specifically whether your mechanic is an "online money game" under the 2025 Act and the 2026 Rules. Several sources say there is no registration route for money games, so a "we're registered" answer isn't available.
For tomorrow, I'd launch solo oaths only, with pools and duels switched off or non-monetary and no real-money deposits until a lawyer signs off. That keeps you launchable and protects everything you've built. I can also update the legal pages to match: remove the house-cut language, rewrite the pool and duel sections, and simplify the stakes policy. Want me to do that once you pick which model to go with?
so my question is in the solo its fine bcz the ppl are vs me and the company is getting the money so rather than duo and squads sharing money cant i format it in the same way as the solo thingie?? so then its fine right??


Yes — changing the economic structure can materially change the legal analysis, but there is an important catch: you cannot simply make Duo/Squad look like Solo while keeping essentially the same wagering mechanic underneath.
Under India's current framework, the Promotion and Regulation of Online Gaming Act, 2025 prohibits offering, operating, facilitating, advertising, or participating in an “online money game,” and the 2026 rules are now in force.
So think about the mechanics, not the labels.
Your proposed structure
Suppose Duo works like this:

Aryan creates an oath
“I will go to the gym 5× this week.”
Aryan puts ₹500 at stake.

His friend joins as the accountability partner, but does not contribute ₹500 and does not become entitled to Aryan's money.
At completion:
Aryan succeeds → ₹500 returned to Aryan.
Aryan fails → ₹500 goes to Oath / a predetermined charity / another permitted destination.
The friend receives zero money either way.
That is fundamentally different from:
Aryan ₹500 + Bob ₹500 → winner receives ₹1,000.
The second structure directly creates a monetary contest between participants. The first is much closer to a commitment contract with another person acting as an accountability participant.
But here's where you need to be careful
You can't have:
“Duo mode”
and secretly make the actual economic event:
“Two players compete, one wins, the other's stake is forfeited.”
Then rename the winner the “accountability partner” and call the stake an “oath deposit.”

That is exactly the kind of substance-over-label problem your lawyer will examine.
The Act itself is concerned with the underlying online-money-game activity, not whether you've called the payment a “stake,” “deposit,” “commitment,” “bond,” etc.
There is actually a much more interesting product architecture for Oath
I would separate accountability participation from economic participation.

SOLO
User → Oath

₹500 commitment.
Success → ₹500 returned.
Failure → predetermined forfeiture destination.
DUO
User A → Oath

₹500 commitment.
User B → Oath
₹0.
B is an accountability partner.
Both can have tasks, check-ins, evidence, reminders, verification, escalation, etc.
But B cannot financially win A's forfeiture.
SQUAD
Same thing:

5 people → 5 independent commitments
They participate in one shared challenge.
But each person's money remains economically tied to that person's own commitment, rather than becoming a pool that another participant can capture.
That still lets you build some pretty fucking powerful mechanics:
“5 friends. 30-day challenge. Everyone commits ₹1,000.”
Everyone can see:

4/5 completed
Aryan — FAILED
Rohan — COMPLETED
Ankit — COMPLETED
But you don't need:
“Aryan lost ₹1,000, therefore Rohan gets ₹250.”
The social pressure can remain extremely strong without creating a monetary prize pool.

And there's one huge thing I would NOT assume
You said:
“in Solo the people are vs me and the company gets the money so it's fine”
Don't treat that as legally established.

The fact that Oath, rather than another player, receives the forfeited money does not automatically make the activity lawful.
The current statute defines and prohibits online money games broadly, and section 5 prohibits offering/operating/facilitating them.
So your lawyer needs to analyze Oath's actual mechanism:
money enters → user makes commitment → outcome is determined → money is returned/forfeited → Oath's economics
rather than merely answering:
“Is Oath a gambling app?”
That's the wrong question.

The useful question is:
Does this particular commitment/forfeiture mechanism constitute an “online money game” or otherwise trigger a regulated/prohibited financial activity under the applicable Indian law?
That's a much stronger legal question to put in front of counsel.

Also, MeitY's current framework specifically provides an Authority to determine whether an online game falls within the relevant categories, so a lawyer can assess whether seeking a formal determination/registration route is available for the non-money-game parts of your product.
Here's the product distinction I'd make
Don't build:

Duo Duel
“Beat your friend and take his money.”
Build:

Duo Oath
“Make a commitment together. Hold each other accountable.”
And don't make the money flow:

Player → pot → winning player
Make it:
Player → their own commitment → predetermined outcome
That is a real mechanical change, not legal wordplay.
And honestly, this may make Oath a better product anyway. You can make the social layer insanely competitive while keeping the financial layer individualized.
One more thing: before launch with actual money, I would have the lawyer review the exact money flow, outcome rules, verification mechanism, refunds, wallet custody, payment processor, and Duo/Squad architecture together. The fact that the law and Rules are now operational makes guessing here a bad business decision.



Bro — your first sentence is the part I need to correct hard.
“It is only illegal if a consumer earns money.”
No. That is not what the Indian statute says. The current Act defines an “online money game” around paying/depositing money or another stake in expectation of winning monetary or other enrichment in return, and the 2026 Rules tell the Authority to look at whether money/stakes are deposited at any stage, what users expect in return, how the payment functions, the revenue model, and how rewards/assets are monetised.
So the useful distinction for Oath is not:
“Does the user make a profit?”
It is:
“What is the payment, what does the user expect in return, and what is the actual economic relationship between the payment and the outcome?”
Your proposed Duo/Squad mechanic
There are actually two very different versions here.
Version A — each Oath is independent
A:
Commitment Amount ₹500
Oath: Gym 5×
Outcome: Completed → ₹500 returned under the Oath terms
Failed → ₹500 forfeited
B:
Commitment Amount ₹500
Oath: Study 20 hours
Outcome: Completed → ₹500 returned
Failed → ₹500 forfeited
A and B are linked socially, but A's result never determines B's money and B's result never determines A's money.
That is the structure I would take to the lawyer.
Version B — “everyone survives or everyone loses”
You have:
A ₹500
B ₹500
C ₹500
and:
A fails → A's ₹500 is gone, but B and C keep going.
That is still structurally understandable as three separate commitments.
But this:
A fails → the entire Duo/Squad financial arrangement changes because of A's failure.
or:
“The challenge only resolves financially when the entire group fails.”
starts making the group outcome financially relevant.
That does not necessarily make it illegal by itself, but I would not tell yourself that it makes the legal position safer. The Rules specifically say the Authority can examine whether the payment makes the service appear to be part of a competitive event between individuals or teams, alongside the payment/stake and revenue model.
In other words:
“Everyone's money is independently attached to their own Oath” = cleaner.
“The squad collectively has one monetary outcome” = more complicated.
So I actually wouldn't use your “I only earn when everyone loses” mechanic as the legal trick.
It gives you a nice product mechanic, but it isn't the thing that establishes legality.
The really important part: “I don't profit”
Suppose Rahul puts ₹1,000 into an Oath.
He succeeds.
You give him ₹1,000 back.
He has not made ₹1,000 profit.
That's obviously better factually than:
₹1,000 → potentially ₹2,000.
But don't jump from that to:
“Therefore it cannot be an online money game.”
The Act's language is not written as a simple net-profit test, and Rule 9(a) expressly asks whether money or another stake is deposited at any stage, by whatever name it is called. Rule 9(b) then asks whether users expect monetary or other enrichment in return for that deposit.
That's why this is one of those cases where the formal determination mechanism matters. The Authority can determine whether a particular online game is an online money game, and its inquiry can examine the technical architecture, gameplay, revenue model and UI.
The Rules came into force on May 1, 2026, so this isn't a hypothetical future framework anymore.
Now, your Oath terminology idea: YES.
This part I actually like.
You can absolutely create a coherent Oath-specific vocabulary.
And honestly, it fits the product better than gaming terminology anyway.
I'd build the entire product lexicon around:
Core
Oath
The user's specific commitment.
Oath Amount or Commitment Amount
The amount associated with that Oath.
Oath Period
The period during which the commitment applies.
Oath Conditions
The objectively defined requirements.
Oath Evidence
Proof submitted by the participant.
Oath Verification
How completion is determined.
Oath Succeeded
The conditions were satisfied.
Oath Forfeited
The conditions were not satisfied and the predetermined consequence applies.
Oath Active
The commitment is currently running.
Oath Completed
The Oath reached its successful endpoint.
Oath Escalation
A predefined increase in accountability pressure.
That's perfectly workable as product terminology.
“Pay the Oath”?
This one I'd change slightly.
Don't make:
PAY YOUR OATH
because it sounds like purchasing/buying something.
I'd use:
Commit ₹500
or:
Set Commitment
or:
Enter Oath
Then the UI could say:
OATH AMOUNT
₹500
And after completion:
OATH SUCCEEDED
Your Commitment Amount is being returned according to the terms of this Oath.
After failure:
OATH FORFEITED
Your Commitment Amount has been forfeited in accordance with the Oath terms.
That is clean.
But there is a crucial rule:
Don't deliberately use obscure terminology to conceal what is happening.
For example:
“Oath Energy Units™”
when users are actually depositing INR.
No.
Your terms should define the terminology plainly:
“Oath Amount” means the INR amount voluntarily committed by a participant in connection with an Oath and subject to the outcome and forfeiture terms disclosed before confirmation.
That's much better legally than pretending the INR is some mysterious “Oath Credits.”
The Act specifically says “other stakes” can include things equivalent or convertible to money regardless of what they are called.
So:
Oath-specific vocabulary = ✅
Oath-specific euphemisms designed to hide a stake = ❌
Words I'd completely eliminate from Oath
Especially in the product UI, marketing and source-code terminology:
Bet
Wager
Gamble
Pot
Prize pool
Jackpot
Odds
Winning amount
Winnings
Payout
Rake
House edge
House wins
Winner takes all
Loser pays winner
Beat your opponent for ₹X
Win ₹X
Cash prize
Bet against your friend
Double your money
Earn from failures
Profit from losing
And I'd kill:
house_cut
winner_id
loser_payout
prize_pool
winnings
odds

from the actual architecture if those concepts don't exist.
Use things like:
commitment_amount
oath_status
oath_outcome
forfeiture_destination
accountability_partner
challenge_members

That's not legal magic. It makes your actual software model correspond to your claimed business model.
And this sentence of yours?
“my friend forfeited but the other one can continue till he has the guts”
YES — from a product-design standpoint, that is much cleaner than forcing the surviving person's Oath to fail.
Actually:
Your friend's Oath was forfeited. Your Oath remains active.
is exactly the kind of relationship I'd want the backend to represent.
The surviving participant has their own Oath.
Their friend's failure is not their financial failure.
Then:
You completed your Oath → your Oath succeeds.
or:
You subsequently failed → your Oath is forfeited.
The other person's result shouldn't determine yours.
That gives you a genuinely nice social mechanic:
“He broke. You haven't.”
Without:
“He lost ₹500, so you won ₹500.”
That's the distinction I'd preserve.

The model I'd take to your lawyer
I'd literally hand them this:
Oath is a commitment and accountability platform in which each participant enters an independently administered Oath. Each Oath has its own defined conditions, commitment amount, verification procedure, success outcome and forfeiture consequence. In Duo and Squad challenges, multiple Oaths may be associated for social accountability and progress tracking, but no participant acquires any financial entitlement to another participant's commitment amount, forfeiture or outcome. A participant's financial outcome is determined solely by that participant's own Oath.
Then ask the lawyer one very specific question:
“Does this mechanism, where a participant's committed INR is returned upon successful completion and is forfeited upon failure, without any participant-to-participant monetary transfer or prize/winnings mechanism, constitute an online money game under Section 2(g) of the Promotion and Regulation of Online Gaming Act, 2025, and if not, what additional structural safeguards are required?”
That is 10× better than asking:
“Can we call ourselves an accountability app so we're legal?”
Because the Rules expressly contemplate an Authority determination based on the game's actual architecture, functionality, revenue model and interface.
And one correction to what I told you earlier: I was too categorical when I said the Solo structure was simply “fine.” The official framework does not give us enough basis to make that automatic conclusion. Your model has a plausible distinction from participant-to-participant wagering, but the lawyer/Authority needs to classify the actual implementation.
That distinction matters a lot before you put real INR through Oath.


Brother, you are not getting my point. First of all, no two people with different Oaths can be seen as a duo, brother. Let's say me and my friends want to go to gym. So we created a duo, a pair, and I joined his team, like the duo team, and he paid 100 rupees to the app called Oath. And when, suppose I am the one who fucked first and I stopped going to the gym. He can continue. He can continue and have that 100 rupees safe, right? But if he also loses, then only Oath gets the 100 rupees. Same with the squad. Let's say we are a group of 10 friends. We all want to go to the gym. Then we created a squad. Everyone gave 50, 50, 50 rupees to the leader. The leader gave X amount to the app called Oath. And if any of us fucked, it's fine. The last one is surviving until then the money is safe. As soon as the last one also fucks up, then only the Oath takes the money, right? The other model that I told you is that we are participating as a duo. If any of us fucked, that means the money is gone. Similarly in the squad, let's say 10 people, 10 of my friends are trying to go to the gym. If any one of them fucked, let's suppose I fucked up, then we all, collectively, the money goes directly without even thinking about who is surviving or who is not. This is what I am asking. Why are you thinking like there are different commitments, but a pair is still formed? How can a pair form if someone wants to go to the gym and other wants to study 40 hours? This is not a pair. These are just solo challenges.

Yes. Now I have your architecture exactly. I was conflating “Duo/Squad” with multiple independent Oaths. You're describing a single shared Oath with multiple participants, where the group collectively chooses the financial consequence.
That changes the question substantially.
Your three models are actually these
1. Duo — “all-or-nothing”
Two friends form one Oath:
“We will both go to the gym for 30 days.”
They collectively commit ₹100 to Oath.
You fail on day 12.
Nothing happens financially yet.
Your friend continues.
If your friend completes day 30:
Shared Oath Succeeded → ₹100 remains safe/returned according to the terms.
If your friend eventually fails too:
Shared Oath Forfeited → Oath receives the ₹100.
So the condition is:
Forfeit = everyone fails
not:
Forfeit = first person fails
2. Squad — survivor model
10 friends create one Squad Oath:
“We will all go to the gym.”
They collectively commit ₹500.
Aryan fails.
₹500 remains locked.
9 people continue.
Another person fails.
₹500 remains locked.
Eventually one person is the last surviving participant.
If that person completes the Oath:
Oath succeeds → commitment preserved/returned.
If that final person fails:
Oath forfeited → Oath receives the ₹500.
So:
Forfeit = the final remaining participant fails.
3. Squad — immediate collective forfeiture
10 people commit ₹500.
One person fails.
Immediately:
Entire Oath forfeited.
This is the model you're asking about whether to avoid.

Now the important legal point
Your model #2 is not automatically illegal merely because several people participate and money is involved.
But it is also not automatically legal merely because Oath gets the money rather than another participant.
The current Indian Act defines an online money game around paying/depositing money or other stakes in expectation of winning monetary or other enrichment in return.
And the 2026 Rules explicitly tell the Online Gaming Authority to look at:
whether money/stakes are deposited at any stage;
whether users expect monetary or other enrichment in return;
whether the payment makes the game appear to be part of a competitive event between individuals/teams;
the revenue model; and
how rewards/benefits are transferred or monetised.
The Authority can examine the actual technical architecture, gameplay mechanics, revenue model and UI when making a determination.
That's why I don't want to tell you:
“Model #2 = definitely legal.”
Nobody can honestly establish that from the statute alone.
But here's the distinction I think you're getting at
Your Squad isn't:
“Ten players compete for ₹500.”
It's:
“Ten people make one collective commitment. The commitment succeeds if at least one participant completes it, and the financial consequence occurs only if the collective commitment ultimately fails.”
That is a commitment contract mechanic, rather than a winner/loser prize mechanic.
And importantly:
there is no monetary winner.
The surviving participant doesn't get ₹500.
Nobody gets another participant's money.
Nobody is trying to multiply their stake.
Oath doesn't pay a prize to whoever survives.
That's a much cleaner factual description of what you're building.
And YES — I now agree with your intuition about the survivor mechanic
Between these two:
A
“One person fails → entire group's money is forfeited.”
and
B
“One person fails → that person is out, but the collective Oath continues until the final surviving participant either succeeds or fails.”
B better preserves the idea that this is one shared commitment rather than a monetary elimination contest.
Why?
Because the financial event isn't triggered by somebody losing to somebody else.
The only financial question is:
Did the collective Oath ultimately succeed or ultimately fail?
That's a much cleaner product philosophy.
I would therefore make the core rule:
The failure of an individual participant does not itself determine the financial outcome of the Shared Oath. The Shared Oath remains active while at least one eligible participant continues to satisfy the Oath requirements. The financial consequence occurs only upon the final determination of the Shared Oath.
That's exactly what you've been trying to explain to me.

But there's one thing I'd change in your wording
Don't say:
“The last guy has to survive.”
And definitely don't say:
“Everyone else lost, so the last guy wins.”
That creates an unmistakable elimination-game framing.
Instead:
“The Shared Oath remains active while one or more participants continue to pursue it.”
Then:
“The Shared Oath succeeds when the applicable completion condition is satisfied.”
or:
“The Shared Oath is forfeited only when the final applicable participant fails to satisfy the Oath conditions.”
That's much more aligned with what you actually built.

And OATH terminology?
Yes. Absolutely.
You don't need to call everything “commitment contract” in the UI. That's lawyer language.
Oath can have its own vocabulary.
For example:
Create an Oath
Make Your Oath
Oath Amount
Oath Conditions
Oath Deadline
Oath Evidence
Oath Verification
Oath Active
Oath Succeeded
Oath Forfeited
Oath Participants
Oath Leader
Oath Complete
Those are perfectly reasonable product terms, provided your Terms clearly explain what each one means.
The Act itself is particularly explicit that something doesn't escape the analysis merely because you give it another name: “other stakes” covers things equivalent/convertible to money regardless of what they're called.
So:
Oath vocabulary = ✅
rename gambling while keeping gambling mechanics = ❌
I would make your legal/product dictionary extremely simple
“Oath”
A predefined commitment undertaken by one or more Participants under stated conditions.
“Shared Oath”
A single Oath undertaken collectively by multiple Participants.
“Oath Amount”
The INR amount associated with the Oath.
“Oath Success”
The Shared Oath's stated success conditions have been satisfied.
“Oath Forfeiture”
The predetermined financial consequence arising when the Shared Oath's stated failure condition occurs.
“Participant”
A person participating in an Oath.
“Active Participant”
A Participant whose participation has not ended under the Oath rules.
“Forfeiture Condition”
The objectively defined condition upon which the Oath Amount becomes subject to forfeiture.

Words I would ban from the entire product
Especially never put these on buttons, landing pages, referral campaigns, notifications, etc.:
Bet
Wager
Gamble
Pot
Prize pool
Jackpot
Odds
Winnings
Winner
Loser
Cash prize
Winner takes all
Beat your friend and win ₹X
Earn ₹X if your friend fails
Take their money
Profit from failure
House edge
Rake
House wins
And I'd rename those concepts in the actual code too.
For example:
shared_oath
participants
oath_amount
oath_conditions
oath_status
participant_status
completion_status
forfeiture_condition
forfeiture_destination

rather than:
pot
winner
loser
winnings
house_cut
payout
odds

One more subtle point
Your leader collecting ₹50 from ten friends and then sending ₹500 to Oath is something I'd have counsel/payment-provider review very carefully.
From the user's perspective, you have:
10 people → money combined → one Oath
That's fine as a product concept, but it means your legal/payment documentation needs to explain whose money the ₹500 legally is, who is making the payment, what the leader is authorised to do, and whose entitlement exists if the Oath succeeds or is forfeited.
I'd actually design the payment flow so the leader is not acting as an informal escrow agent:
Each participant authorises their own ₹50 contribution to the Shared Oath.
Then Oath records:
Shared Oath Amount = ₹500
Participant contributions = 10 × ₹50
That is much cleaner from an audit trail and consumer-protection perspective than:
“Give Rahul ₹50 and Rahul sends ₹500 to Oath.”
Especially because the 2026 Rules give the Authority power over directions concerning financial transactions and funds associated with online games.
So, boiled down to your exact question:
Yes, I now understand your model.
Your intended mechanic is:
One shared Oath → multiple people → one collective financial commitment → individual failure removes that person's participation but does not forfeit the commitment → the Oath survives as long as an eligible participant continues → only final collective failure triggers forfeiture → nobody receives the forfeited money except the predetermined destination.
That is the version I'd have your lawyer examine, rather than the “first person fails = everyone loses” version.
But don't tell yourself “therefore it's definitely legal.” The current framework expressly gives the Authority power to classify the specific game using its mechanics, money flow, revenue model and UI.
And honestly, this exact distinction should now become part of Oath's technical architecture, not merely its Terms of Service. If your backend literally implements the survivor model, the legal description and the code are telling the same story.


so the marketing can be like "stop us from making money, and you yourself become better" right??

Yes — that is a strong marketing direction, with one important wording adjustment.
Your idea:
“Stop us from making money, and you become better.”
is actually good because it communicates the core tension of Oath: Oath earns when the user breaks the commitment; the user wins by succeeding.
But I would make the public-facing claim a little more precise, because Indian law prohibits advertising that directly or indirectly promotes or induces an online money game. Whether Oath falls within that category depends on the actual product mechanics and classification, not merely the slogan.
I'd use this kind of messaging
STOP US FROM MAKING MONEY.
KEEP YOUR OATH.
or:
MAKE US LOSE.
KEEP YOUR OATH.
or my favorite:
WE MAKE MONEY WHEN YOU BREAK.
SO DON'T.
That last one is fucking strong for Oath.
It gives the user the exact psychological loop:
Oath wants you to fail → you refuse to fail → you improve yourself.
But don't market it as:
“Bet ₹100 and win it back.”
or:
“Beat your friends and win money.”
or:
“Make money by completing your Oath.”
Those introduce the exact monetary-winning framing you're trying to avoid.
And importantly, don't claim “Oath is not gambling” as a marketing/legal conclusion yet. The statute gives the Online Gaming Authority power to determine whether a particular game is an online money game, and the rules permit examination of the game's mechanics, technical architecture, UI and revenue model.
Your brand positioning could actually be very clean
OATH
Your word is binding.
Then:
We make money when you break your word.
Your job is to make us lose.
That's a much better explanation of the business than calling yourselves a “gambling-free gambling app” or trying to dance around the terminology.
One caveat: have counsel approve that exact sentence too, because it explicitly talks about money being contingent on failure. The safest marketing position is one that accurately describes your actual commitment mechanism without making monetary outcomes the attraction. The Act's advertising prohibition is broad enough to cover direct or indirect promotion of a prohibited online money game.
"