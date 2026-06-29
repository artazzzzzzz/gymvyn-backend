'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const allExercises = [
  // ── Biceps ────────────────────────────────────────────────────────────────
  {
    "muscle_group": "Biceps",
    "exercise_name": "Barbell Curl",
    "how_to_do": [
      "Stand tall holding a barbell with an underhand grip, hands roughly shoulder-width apart.",
      "Pin your elbows tightly against your ribs and brace your core.",
      "Curl the barbell upward in a smooth arc toward your upper chest, squeezing your biceps.",
      "Lower the bar under strict control back to the starting position."
    ],
    "pro_tip": "Squeeze your glutes tightly during the entire set. This locks your pelvis in place and completely prevents you from swinging your lower back to cheat the weight up."
  },
  {
    "muscle_group": "Biceps",
    "exercise_name": "Barbell Drag Curl",
    "how_to_do": [
      "Stand tall holding a barbell with an underhand grip, resting against your thighs.",
      "Instead of curling in an arc, pull the barbell straight up by dragging it touching your torso.",
      "Drive your elbows straight back behind your body as the bar rises to your lower chest.",
      "Squeeze your biceps at the top, then slowly drag the bar back down."
    ],
    "pro_tip": "Do not shrug your shoulders. Keep your shoulders pressed down and focus entirely on driving the elbows backward to hyper-isolate the long head of the bicep."
  },
  {
    "muscle_group": "Biceps",
    "exercise_name": "Barbell Prone Incline Curl",
    "how_to_do": [
      "Set an adjustable bench to a 45-degree angle and lie face down with your chest on the pad.",
      "Hold a barbell with an underhand grip, letting your arms hang perfectly straight down toward the floor.",
      "Curl the barbell straight up toward your chin, keeping your upper arms locked in place.",
      "Slowly lower the bar back to a dead hang."
    ],
    "pro_tip": "This exercise (also known as a Spider Curl) completely eliminates momentum. Keep your chest glued to the pad; if your chest lifts off, the weight is too heavy."
  },
  {
    "muscle_group": "Biceps",
    "exercise_name": "Cable One Arm Curl",
    "how_to_do": [
      "Attach a D-handle to a low cable pulley and stand facing the machine.",
      "Grasp the handle with one hand and take a small step back to put tension on the cable.",
      "Keep your elbow tucked at your side and curl the handle upward to your shoulder.",
      "Resist the weight smoothly as you lower your arm back to full extension."
    ],
    "pro_tip": "Because cables provide constant tension, do not rest at the bottom. The moment your arm reaches full extension, instantly begin the next curling rep."
  },
  {
    "muscle_group": "Biceps",
    "exercise_name": "Cable Standing Inner Curl",
    "how_to_do": [
      "Attach a straight bar to a low cable pulley and stand facing the machine.",
      "Take a wide, underhand grip on the bar (hands wider than shoulder-width).",
      "Curl the bar upward toward your chest, keeping your elbows locked at your sides.",
      "Control the descent back to the starting position."
    ],
    "pro_tip": "The wide grip shifts the primary focus to the short head (inner portion) of the bicep, which builds the overall thickness and width of the arm."
  },
  {
    "muscle_group": "Biceps",
    "exercise_name": "Concentration Curl",
    "how_to_do": [
      "Sit on the edge of a bench with your legs spread wide.",
      "Hold a dumbbell in one hand and press the back of your lower triceps against your inner thigh.",
      "Curl the dumbbell upward toward your chest, focusing purely on the bicep contraction.",
      "Lower the dumbbell slowly until your arm is fully straight."
    ],
    "pro_tip": "Do not rest your elbow directly on top of your knee joint. Anchor the meaty part of your triceps against your inner thigh to prevent slipping and joint pain."
  },
  {
    "muscle_group": "Biceps",
    "exercise_name": "Drag Curl",
    "how_to_do": [
      "Stand holding a barbell or dumbbells against your upper thighs.",
      "Pull the weight upward by dragging it directly up your shirt line.",
      "Let your elbows point backward, stopping when the weight reaches your mid-chest.",
      "Slowly reverse the motion, keeping the weight in contact with your body."
    ],
    "pro_tip": "Forget about the standard curling arc. Pretend your hands are bolted to your torso and the only way to lift them is to pull your elbows directly behind you."
  },
  {
    "muscle_group": "Biceps",
    "exercise_name": "Dumbbell Alternate Biceps Curl",
    "how_to_do": [
      "Stand holding a dumbbell in each hand by your sides with a neutral grip (palms facing your legs).",
      "Curl your right arm upward, rotating your wrist so your palm faces your shoulder at the top.",
      "Lower the right dumbbell back to your side.",
      "Repeat the motion with your left arm, alternating sides."
    ],
    "pro_tip": "Supination (the twisting of the wrist) is key here. As you reach the top of the curl, try to twist your pinky finger outward as far as possible to peak the bicep."
  },
  {
    "muscle_group": "Biceps",
    "exercise_name": "Dumbbell Alternate Seated Biceps Curl",
    "how_to_do": [
      "Sit on a bench with vertical back support, holding dumbbells hanging at your sides.",
      "Keeping your back firmly pressed against the pad, curl one dumbbell up and twist your palm toward you.",
      "Squeeze at the top, then lower it slowly.",
      "Alternate and perform the curl with your other arm."
    ],
    "pro_tip": "Sitting with back support eliminates the ability to use your legs or lower back for momentum. This forces strict isolation and requires intense bicep engagement."
  },
  {
    "muscle_group": "Biceps",
    "exercise_name": "Dumbbell Biceps Curl",
    "how_to_do": [
      "Stand tall, holding a pair of dumbbells at your sides with your palms facing forward (supinated grip).",
      "Keep your upper arms totally stationary and curl both dumbbells simultaneously toward your shoulders.",
      "Hold the peak contraction for one second.",
      "Lower the weights slowly and smoothly to full extension."
    ],
    "pro_tip": "Keep your wrists straight and stiff. If your wrists curl inward at the top of the movement, you are taking tension off the biceps and placing it on the forearms."
  },
  {
    "muscle_group": "Biceps",
    "exercise_name": "Dumbbell Concentration Curl",
    "how_to_do": [
      "Sit on a bench and hinge forward, holding a dumbbell in one hand.",
      "Wedge your triceps against your inner thigh to lock your arm in place.",
      "Curl the weight up to your shoulder while your free hand rests on your other leg for stability.",
      "Slowly lower the weight back down."
    ],
    "pro_tip": "Look directly at your working bicep during the set. This visual mind-muscle connection drastically improves your ability to command the muscle fibers to contract."
  },
  {
    "muscle_group": "Biceps",
    "exercise_name": "Dumbbell Cross Body Hammer Curl",
    "how_to_do": [
      "Stand holding a dumbbell in each hand with a neutral grip (palms facing inward).",
      "Without twisting your wrist, curl one dumbbell across the front of your torso toward the opposite shoulder.",
      "Squeeze at the top, then slowly lower the dumbbell back to your side.",
      "Repeat the crossing motion with the other arm."
    ],
    "pro_tip": "This uniquely targets the brachialis (the muscle underneath the bicep). Developing the brachialis actually pushes the main bicep up, creating a much higher peak."
  },
  {
    "muscle_group": "Biceps",
    "exercise_name": "Dumbbell Curl",
    "how_to_do": [
      "Stand with feet shoulder-width apart, holding a dumbbell in each hand.",
      "Turn your palms so they are facing forward.",
      "Curl the weights up toward your shoulders in a smooth arc.",
      "Lower the weights completely until your triceps flex at the bottom."
    ],
    "pro_tip": "Flexing your triceps at the very bottom of every rep ensures that your bicep gets a 100% full stretch before initiating the next contraction."
  },
  {
    "muscle_group": "Biceps",
    "exercise_name": "Dumbbell Incline Biceps Curl",
    "how_to_do": [
      "Set a bench to a 45-degree incline and lie back with a dumbbell in each hand.",
      "Let your arms hang straight down toward the floor, keeping your palms facing forward.",
      "Keeping your elbows slightly behind your torso, curl the weights up toward your shoulders.",
      "Lower the weights back down to a full, dead-hang stretch."
    ],
    "pro_tip": "This exercise puts the long head of the bicep under extreme stretch. Keep the weights relatively light and focus entirely on the deep pull at the bottom of the movement."
  },
  {
    "muscle_group": "Biceps",
    "exercise_name": "Dumbbell Incline Hammer Curl",
    "how_to_do": [
      "Lie back on a 45-degree incline bench with dumbbells hanging straight down.",
      "Use a neutral grip (palms facing each other) throughout the entire movement.",
      "Curl the dumbbells upward toward your shoulders like you are holding two hammers.",
      "Lower the weights slowly, maintaining the neutral grip."
    ],
    "pro_tip": "Keep your head resting against the bench pad. Tucking your chin to look down strains your neck and ruins the postural alignment needed for this intense stretch."
  },
  {
    "muscle_group": "Biceps",
    "exercise_name": "Dumbbell One Arm Zottman Preacher Curl",
    "how_to_do": [
      "Position yourself on a preacher bench holding one dumbbell with an underhand grip.",
      "Curl the dumbbell up to your shoulder normally.",
      "At the top of the movement, rotate your wrist 180 degrees so your palm faces the floor (overhand).",
      "Slowly lower the dumbbell with this overhand grip, then twist back to underhand at the bottom."
    ],
    "pro_tip": "The eccentric (lowering) phase with the overhand grip builds massive, thick forearms, while the upward phase builds the bicep. Do not rush the downward phase!"
  },
  {
    "muscle_group": "Biceps",
    "exercise_name": "Dumbbell Preacher Curl Over Exercise Ball",
    "how_to_do": [
      "Kneel on the floor with a stability ball in front of you.",
      "Hold a dumbbell in one hand and drape your arm over the ball, using it like a soft preacher pad.",
      "Curl the dumbbell upward, keeping your upper arm pressed into the ball.",
      "Lower the weight smoothly, fighting the instability."
    ],
    "pro_tip": "Because the ball is soft and shifts, your core must engage heavily to keep your body stable. Drive your chest into the ball to anchor yourself down."
  },
  {
    "muscle_group": "Biceps",
    "exercise_name": "Dumbbell Prone Incline Curl",
    "how_to_do": [
      "Lie chest-down on an incline bench holding dumbbells, letting your arms hang straight to the floor.",
      "Turn your palms forward and curl both dumbbells up toward your face.",
      "Squeeze at the top of the contraction for a full second.",
      "Lower the weights down until your arms are perfectly vertical again."
    ],
    "pro_tip": "Pretend your upper arms are bolted to invisible steel beams. They must remain completely vertical; only your forearms should move in an upward arc."
  },
  {
    "muscle_group": "Biceps",
    "exercise_name": "Dumbbell Seated Preacher Curl",
    "how_to_do": [
      "Adjust the seat of the preacher bench so your armpits rest comfortably over the top edge of the pad.",
      "Grasp a dumbbell and lower it until your arm is nearly fully extended.",
      "Contract your bicep to curl the weight up toward your chin.",
      "Control the descent back to the starting point."
    ],
    "pro_tip": "Never fully lock out your elbows at the absolute bottom of a preacher curl. Stopping a fraction of an inch before lockout keeps the tension on the muscle and protects your bicep tendon from tearing."
  },
  {
    "muscle_group": "Biceps",
    "exercise_name": "EZ Barbell Biceps Curl",
    "how_to_do": [
      "Stand holding an EZ curl bar using the slightly angled, outer grips.",
      "Keep your chest proud and your elbows locked into your sides.",
      "Curl the bar upward toward your shoulders.",
      "Slowly lower the bar back down to your thighs."
    ],
    "pro_tip": "The cambered (angled) shape of the EZ bar puts your wrists in a semi-supinated position, which drastically reduces wrist and elbow pain compared to a straight barbell."
  },
  {
    "muscle_group": "Biceps",
    "exercise_name": "Hammer Curl",
    "how_to_do": [
      "Stand tall holding dumbbells at your sides with your palms facing each other.",
      "Keeping your elbows fixed, curl the weights up toward your shoulders, maintaining the neutral grip.",
      "Squeeze your biceps and forearms at the top.",
      "Lower the weights smoothly back down."
    ],
    "pro_tip": "Imagine you are holding two heavy pints of beer. If you twist your wrists, you'll spill them. Keep the grip strictly neutral to maximize brachioradialis growth."
  },
  {
    "muscle_group": "Biceps",
    "exercise_name": "Incline Dumbbell Curl",
    "how_to_do": [
      "Lie back on an incline bench set to 45 degrees, holding dumbbells at your sides.",
      "Turn your palms forward and lock your shoulders down and back.",
      "Curl the weights up simultaneously, keeping your elbows from drifting forward.",
      "Lower the dumbbells all the way back to a dead hang."
    ],
    "pro_tip": "Puff your chest out proudly throughout the entire set. If your chest caves in, your shoulders will roll forward, and you will lose the extreme bicep stretch."
  },
  {
    "muscle_group": "Biceps",
    "exercise_name": "Lever Preacher Curl",
    "how_to_do": [
      "Sit in the machine and adjust the seat so your elbows rest exactly on the pad's pivot point.",
      "Grip the handles and keep your chest pressed against the support pad.",
      "Curl the machine handles toward you, feeling the isolation.",
      "Resist the weight stack smoothly on the way down."
    ],
    "pro_tip": "Aligning your elbows perfectly with the machine's mechanical pivot axis is critical. If you are misaligned, the resistance curve will feel unnatural and place severe stress on your elbow joints."
  },
  {
    "muscle_group": "Biceps",
    "exercise_name": "Lying Supine Dumbbell Curl",
    "how_to_do": [
      "Lie completely flat on your back on a high bench.",
      "Hold a dumbbell in each hand, letting your arms hang straight down toward the floor.",
      "Keeping your upper arms fixed, curl the dumbbells up toward the ceiling.",
      "Slowly lower them back down to the floor."
    ],
    "pro_tip": "This variation places your biceps under a brutal, unusual stretch. Start with half the weight you usually curl to condition your tendons before pushing to failure."
  },
  {
    "muscle_group": "Biceps",
    "exercise_name": "Preacher Curl",
    "how_to_do": [
      "Sit at a preacher bench and grab a barbell or EZ bar with an underhand grip.",
      "Rest the back of your upper arms flat against the angled pad.",
      "Curl the bar up until your forearms are vertical.",
      "Lower the weight back down slowly until your arms are almost fully extended."
    ],
    "pro_tip": "Once your forearms pass vertical at the top, gravity removes the tension from your biceps. Stop the curl just before vertical to maintain 100% constant tension."
  },
  {
    "muscle_group": "Biceps",
    "exercise_name": "Resistance Band Curl",
    "how_to_do": [
      "Stand on the center of a resistance band with your feet shoulder-width apart.",
      "Hold the ends of the band in your hands with an underhand grip.",
      "Curl your hands up toward your shoulders against the band's tension.",
      "Control the band as it pulls your hands back down."
    ],
    "pro_tip": "Resistance bands possess 'accommodating resistance'—they get heavier the higher you pull. Capitalize on this by holding the peak contraction for 2 full seconds on every rep."
  },
  {
    "muscle_group": "Biceps",
    "exercise_name": "Seated Dumbbell Curl",
    "how_to_do": [
      "Sit on a bench, keeping your torso completely upright and holding dumbbells hanging at your sides.",
      "Curl both weights upward, supinating your wrists (palms up) as they rise.",
      "Squeeze your biceps at the top.",
      "Lower the dumbbells back to your sides under control."
    ],
    "pro_tip": "If you find yourself swinging backward to get the weight up, switch to a bench with a back support to enforce strict form and stop the cheating."
  },
  {
    "muscle_group": "Biceps",
    "exercise_name": "Standing Cable Curl",
    "how_to_do": [
      "Attach a straight bar or EZ bar attachment to a low cable pulley.",
      "Stand facing the machine, take an underhand grip, and brace your core.",
      "Curl the bar up to your chest while keeping your elbows glued to your sides.",
      "Slowly lower the bar back to the starting position."
    ],
    "pro_tip": "Take one small step backward from the machine. This slight angle ensures that the cable is still trying to pull your arms forward even at the bottom, keeping tension on the muscle."
  },
  {
    "muscle_group": "Biceps",
    "exercise_name": "Standing One-Arm Curl",
    "how_to_do": [
      "Stand holding a single dumbbell in one hand, resting by your side.",
      "Place your non-working hand on your hip or stomach.",
      "Curl the dumbbell upward, focusing 100% of your neural drive into that single bicep.",
      "Lower the weight back down, complete your reps, and switch arms."
    ],
    "pro_tip": "Placing your free hand firmly on your stomach acts as a physical reminder to keep your core braced tight. Do not let the asymmetrical weight twist your spine."
  },
  {
    "muscle_group": "Biceps",
    "exercise_name": "Stretching - Butterfly Yoga Pose",
    "how_to_do": [
      "Sit on the floor, bend your knees, and bring the soles of your feet together.",
      "To stretch the biceps in this seated position, place your hands flat on the floor directly behind your hips.",
      "Point your fingers away from your body and slowly walk your hands further backward.",
      "Puff your chest out and hold the position when you feel a deep stretch in your biceps and chest."
    ],
    "pro_tip": "Keep your arms completely locked out. Bending your elbows will immediately release the stretch from the bicep tendon."
  },

  // ── Calves ────────────────────────────────────────────────────────────────
  {
    "muscle_group": "Calves",
    "exercise_name": "Band Standing Calf Raise",
    "how_to_do": [
      "Stand tall and place the balls of your feet over the center of a resistance band.",
      "Grip the ends of the band securely at your sides or up by your shoulders to create tension.",
      "Push down through the balls of your feet to raise your heels as high as possible.",
      "Lower your heels back to the floor in a slow, controlled manner."
    ],
    "pro_tip": "Hold the top contracted position for 2 full seconds. Because resistance bands pull hardest at the top of the movement, this isometric hold will scorch your calves."
  },
  {
    "muscle_group": "Calves",
    "exercise_name": "Donkey Calf Raise",
    "how_to_do": [
      "Position yourself in the donkey calf raise machine, resting your lower back/pelvis snugly under the pad.",
      "Place the balls of your feet on the edge of the platform and let your heels hang off.",
      "Drop your heels down to feel a massive stretch in your calves.",
      "Drive your toes into the platform to lift your heels up to a full contraction."
    ],
    "pro_tip": "The bent-over position places the hamstrings and calves in a uniquely stretched state. Do not bounce at the bottom; let the weight stretch you for a full second before pressing."
  },
  {
    "muscle_group": "Calves",
    "exercise_name": "Dumbbell Seated Calf Raise",
    "how_to_do": [
      "Sit on the edge of a flat bench and place the balls of your feet on an elevated block or weight plate.",
      "Rest a heavy dumbbell vertically on top of each knee.",
      "Let your heels drop down toward the floor until you feel a deep stretch.",
      "Push through the balls of your feet to raise your heels as high as they can go."
    ],
    "pro_tip": "Seated calf raises strictly isolate the 'soleus' (the thick muscle under the main calf block). Use heavy weights and high reps, as the soleus is highly fatigue-resistant."
  },
  {
    "muscle_group": "Calves",
    "exercise_name": "Dumbbell Single Leg Calf Raise",
    "how_to_do": [
      "Stand on the edge of a block or stair with one foot, letting the heel hang off.",
      "Hold a dumbbell in the hand on the same side as your working leg, and use your free hand to hold a wall for balance.",
      "Drop your heel down to maximize the stretch.",
      "Drive straight up onto your tiptoes, squeezing the calf hard."
    ],
    "pro_tip": "Hold the dumbbell on the working side. This directly loads the center of gravity over the active calf, providing far superior isolation than holding it on the opposite side."
  },
  {
    "muscle_group": "Calves",
    "exercise_name": "Dumbbell Standing Calf Raise",
    "how_to_do": [
      "Stand tall holding a pair of heavy dumbbells down by your sides.",
      "Position the balls of your feet on a raised block, with your heels hanging off.",
      "Keeping your knees mostly straight, lower your heels toward the floor.",
      "Press through your toes to elevate your body upward."
    ],
    "pro_tip": "Actively push your weight through your big toe, rather than rolling to the outside of your foot. This heavily activates the inner head (medial gastrocnemius) of the calf."
  },
  {
    "muscle_group": "Calves",
    "exercise_name": "Lever Seated Calf Raise",
    "how_to_do": [
      "Sit in the machine and place the balls of your feet on the lower platform.",
      "Adjust the thigh pads so they lock down snugly just above your knees.",
      "Release the safety latch and slowly lower your heels to stretch the soleus muscle.",
      "Drive your knees upward by pushing through your toes."
    ],
    "pro_tip": "If you don't feel a massive burn, your tempo is too fast. Try a 3-1-3 tempo: 3 seconds down, 1 second pause at the bottom stretch, and 3 seconds to press up."
  },
  {
    "muscle_group": "Calves",
    "exercise_name": "Lever Standing Calf Raise",
    "how_to_do": [
      "Step into the machine and place your shoulders securely under the pads.",
      "Position your toes on the edge of the step block.",
      "Stand up straight to unrack the weight, keeping a micro-bend in your knees.",
      "Lower your heels deep into a stretch, then explode upward onto your toes."
    ],
    "pro_tip": "Never lock your knees out completely backwards (hyperextension). Keep them rigid but with a microscopic bend to protect the knee joint from carrying the entire load."
  },
  {
    "muscle_group": "Calves",
    "exercise_name": "Seated Calf Raise",
    "how_to_do": [
      "Sit on the machine, plant the balls of your feet on the step, and lower the pad over your thighs.",
      "Disengage the safety handle.",
      "Lower your heels down as far as your ankle mobility allows.",
      "Press the weight up smoothly until your calves are fully contracted."
    ],
    "pro_tip": "Do not bounce the weight up using your Achilles tendon! Stop dead at the bottom of the movement for 2 seconds to dissipate kinetic energy and force the muscle to work."
  },
  {
    "muscle_group": "Calves",
    "exercise_name": "Single-Leg Calf Raise",
    "how_to_do": [
      "Stand on the edge of a step or block with one foot.",
      "Tuck your non-working foot behind your working ankle.",
      "Hold onto a wall or rail lightly for balance.",
      "Lower your working heel deep into a stretch, then press all the way up to the top."
    ],
    "pro_tip": "Unilateral (one-sided) calf training is the fastest way to fix imbalances. Always start with your weaker calf, and only do as many reps on your strong calf as your weak one could handle."
  },
  {
    "muscle_group": "Calves",
    "exercise_name": "Sled 45 Degree Calf Press",
    "how_to_do": [
      "Sit in the 45-degree leg press machine and press the sled up until your legs are straight.",
      "Slide your feet down so only the balls of your feet remain on the bottom edge of the platform.",
      "Keeping your legs straight, let the sled push your toes backward to stretch the calves.",
      "Press the sled forward by pointing your toes like a ballerina."
    ],
    "pro_tip": "Keep your hips and lower back glued to the seat pad. If you lift your hips up to push the sled, you are cheating the movement and risking lower back injury."
  },
  {
    "muscle_group": "Calves",
    "exercise_name": "Smith Calf Raise",
    "how_to_do": [
      "Place a block or weight plate under the bar of a Smith machine.",
      "Step under the bar, resting it on your traps, and place the balls of your feet on the edge of the block.",
      "Unrack the bar and slowly lower your heels toward the floor.",
      "Push forcefully up onto your toes."
    ],
    "pro_tip": "The Smith machine provides perfect vertical stability, meaning you don't have to balance. Use this to safely load much heavier weight than you could with free weights."
  },
  {
    "muscle_group": "Calves",
    "exercise_name": "Smith Machine Calf Raise",
    "how_to_do": [
      "Set the Smith machine bar to shoulder height and grab a sturdy step block.",
      "Rest the bar on your upper back and stand on the edge of the block with your toes.",
      "Let your heels drop deep into the negative portion of the lift.",
      "Drive back up to a peak contraction, squeezing the calves."
    ],
    "pro_tip": "Try changing your foot angle. Pointing your toes slightly outward hits the inner calf, while pointing them slightly inward shifts the focus to the outer calf sweep."
  },
  {
    "muscle_group": "Calves",
    "exercise_name": "Standing Calf Raise",
    "how_to_do": [
      "Step into the standing calf raise machine, placing the pads over your shoulders.",
      "Put the balls of your feet on the step.",
      "Lower your heels down slowly to feel a complete stretch in the back of your lower leg.",
      "Press up powerfully onto your toes and hold the squeeze at the top."
    ],
    "pro_tip": "The gastrocnemius (the visible, diamond-shaped calf muscle) is primarily fast-twitch muscle fiber. It responds best to explosive presses and heavy loads when your legs are straight."
  },
  {
    "muscle_group": "Calves",
    "exercise_name": "Stretching - Calf Stretch with Rope",
    "how_to_do": [
      "Sit on the floor with your legs straight out in front of you.",
      "Loop a rope, towel, or resistance band around the ball of your foot.",
      "Keep your leg straight and gently pull the rope toward your body.",
      "Hold the stretch for 30-45 seconds, then switch legs."
    ],
    "pro_tip": "Make sure the rope is wrapped around the ball of the foot (just under the toes) rather than the arch. This provides maximum leverage to stretch the upper calf."
  },
  {
    "muscle_group": "Calves",
    "exercise_name": "Stretching - Calf Stretch with Strap",
    "how_to_do": [
      "Sit on the floor, extend one leg, and bend the other inward.",
      "Place a yoga strap across the upper pad of your extended foot.",
      "Sit up completely straight and pull back on the strap, flexing your toes toward your shin.",
      "Breathe deeply and hold for 30 seconds."
    ],
    "pro_tip": "Do not round your upper back to pull harder. Keep your spine perfectly straight; the movement should come entirely from the ankle hinge."
  },
  {
    "muscle_group": "Calves",
    "exercise_name": "Stretching - Circles Knee Stretch",
    "how_to_do": [
      "Stand with your feet close together and bend your knees slightly.",
      "Place your hands firmly on your kneecaps.",
      "Slowly rotate your knees in a circular motion, keeping your feet flat on the floor.",
      "Do 10 circles clockwise, then 10 circles counter-clockwise."
    ],
    "pro_tip": "This acts as a dynamic warm-up for the ankles, knees, and calves. Use it to lubricate the joints before heavily loading them in squat or calf raise movements."
  },
  {
    "muscle_group": "Calves",
    "exercise_name": "Stretching - Feet and Ankles Rotation Stretch",
    "how_to_do": [
      "Sit on a chair or the floor and cross one ankle over your opposite knee.",
      "Use your hand to gently grasp your foot and slowly rotate your ankle in a wide circle.",
      "Complete 10 large circles in one direction, then 10 in the other.",
      "Switch feet and repeat."
    ],
    "pro_tip": "Take the ankle through its absolute maximum range of motion. Tight ankles limit squat depth and cause knee pain; this drill is essential for lower body mobility."
  },
  {
    "muscle_group": "Calves",
    "exercise_name": "Stretching - Feet and Ankles Stretch",
    "how_to_do": [
      "Sit with your legs extended straight out.",
      "Actively point your toes as far forward as possible (plantar flexion) and hold for 5 seconds.",
      "Then, pull your toes as far back toward your shins as possible (dorsiflexion) and hold for 5 seconds.",
      "Repeat this cycle 5 to 10 times."
    ],
    "pro_tip": "This 'pumping' motion is excellent for clearing out lactic acid and increasing blood flow to the lower extremities after a brutal leg day."
  },
  {
    "muscle_group": "Calves",
    "exercise_name": "Stretching - Peroneals Stretch",
    "how_to_do": [
      "Sit in a chair and cross your right ankle over your left knee.",
      "Use your hand to gently pull the outer edge of your right foot inward, tilting the sole of your foot to face the ceiling.",
      "You should feel a stretch along the outer edge of your calf and ankle.",
      "Hold for 30 seconds, then switch legs."
    ],
    "pro_tip": "The peroneals (outer calf muscles) get highly strained from running or jumping on hard surfaces. Stretch these regularly to prevent shin splints and ankle pain."
  },
  {
    "muscle_group": "Calves",
    "exercise_name": "Stretching - Seated Calf Stretch",
    "how_to_do": [
      "Sit on the floor with your legs straight out in front of you.",
      "Hinge at the hips and reach forward to grab your toes.",
      "If you can reach them, gently pull your toes back toward your shins to deepen the calf stretch.",
      "Hold for 30 seconds while keeping your knees locked."
    ],
    "pro_tip": "If you cannot reach your toes, do not aggressively yank your body forward. Grab your ankles or shins, and simply focus on actively flexing your toes back."
  },
  {
    "muscle_group": "Calves",
    "exercise_name": "Stretching - Stairs Calf Stretch",
    "how_to_do": [
      "Stand on the edge of a step or sturdy box with the balls of your feet.",
      "Hold onto a handrail for safety.",
      "Slowly drop both heels off the edge of the step toward the floor.",
      "Let gravity pull you into a deep stretch and hold for 45-60 seconds."
    ],
    "pro_tip": "Try bending your knees slightly while holding the stretch. Straight legs stretch the upper gastrocnemius, while bent knees stretch the deeper soleus muscle."
  },
  {
    "muscle_group": "Calves",
    "exercise_name": "Stretching - Standing Bench Calf Stretch",
    "how_to_do": [
      "Stand facing a flat bench or a low chair.",
      "Place the ball of your foot on the edge of the bench, keeping your heel firmly planted on the floor.",
      "Slowly lean your hips and torso forward until you feel a strong stretch up the back of your leg.",
      "Hold for 30 seconds per leg."
    ],
    "pro_tip": "Keep your back leg completely straight to ensure the stretch hits the high, meaty part of the calf behind your knee."
  },

  // ── Cardio ────────────────────────────────────────────────────────────────
  {
    "muscle_group": "Cardio",
    "exercise_name": "Battle Ropes",
    "how_to_do": [
      "Stand with your feet shoulder-width apart and drop into a quarter squat.",
      "Grip one end of the rope in each hand with your palms facing each other.",
      "Explosively whip one arm up and down to create a wave in the rope.",
      "Instantly follow with the other arm, alternating rapidly to keep continuous waves flowing to the anchor point."
    ],
    "pro_tip": "Move entirely from your shoulders and arms while keeping your core rigidly braced. If your entire torso is bobbing up and down, you are leaking energy and losing the core benefit."
  },
  {
    "muscle_group": "Cardio",
    "exercise_name": "Battling Ropes",
    "how_to_do": [
      "Assume an athletic stance: feet wide, hips back, and knees slightly bent.",
      "Hold the ropes with a firm grip, keeping your chest up and shoulders back.",
      "Lift both arms simultaneously and slam the ropes down into the floor as hard as possible.",
      "Immediately pull them back up and repeat the double-slam motion."
    ],
    "pro_tip": "Slam the ropes down as if you are trying to break the floor. The downward phase is where the maximal power and core contraction occur."
  },
  {
    "muscle_group": "Cardio",
    "exercise_name": "Burpee",
    "how_to_do": [
      "Stand tall, then quickly drop your hips and place your hands on the floor in front of you.",
      "Kick your feet back explosively so you land in a high push-up plank position.",
      "Perform a strict push-up, dropping your chest to the floor.",
      "Jump your feet back to your hands, then leap vertically into the air, reaching overhead."
    ],
    "pro_tip": "Pace yourself. The burpee is a marathon, not a sprint. Find a steady rhythm you can maintain rather than burning out in the first 15 seconds."
  },
  {
    "muscle_group": "Cardio",
    "exercise_name": "Burpees",
    "how_to_do": [
      "Drop into a crouch position and plant your hands firmly on the ground.",
      "Shoot your legs backward to enter a tight plank position.",
      "Drop your chest and thighs to the floor.",
      "Press up, snap your hips to pull your feet to your hands, and jump straight up."
    ],
    "pro_tip": "Keep your core incredibly tight when you kick your feet back into the plank. Letting your lower back sag towards the floor puts immense, dangerous pressure on the lumbar spine."
  },
  {
    "muscle_group": "Cardio",
    "exercise_name": "Cardio Exercises",
    "how_to_do": [
      "Select a movement or series of movements that elevate your heart rate (e.g., high knees, mountain climbers).",
      "Perform a 3-minute light warm-up to prepare the joints and lungs.",
      "Execute the exercise at a sustained, intense pace to reach your target heart rate zone.",
      "Gradually slow your pace for a 2-minute cool-down."
    ],
    "pro_tip": "Focus on breathing through your nose and exhaling through your mouth. Panic-breathing entirely through your mouth spikes your heart rate prematurely."
  },
  {
    "muscle_group": "Cardio",
    "exercise_name": "Cardio Exercises Machines",
    "how_to_do": [
      "Choose a machine (rower, stair climber, elliptical, etc.) and adjust the settings to your body size.",
      "Start with low resistance and low speed to get the blood flowing.",
      "Increase the resistance and speed until you hit a challenging but sustainable output.",
      "Maintain strict posture, keeping your chest open to allow maximum oxygen intake."
    ],
    "pro_tip": "Do not lean heavily on the machine's handrails. Supporting your bodyweight with your arms drastically reduces the amount of calories you are burning."
  },
  {
    "muscle_group": "Cardio",
    "exercise_name": "Elliptical",
    "how_to_do": [
      "Step onto the pedals and grip the moving handles.",
      "Begin pedaling forward in a smooth, fluid, oval motion.",
      "Actively push and pull the handles to engage your upper body while your legs drive the pedals.",
      "Keep your torso completely vertical and your core braced."
    ],
    "pro_tip": "Drive the pedals down through your heels, not your toes. Pushing through the heels activates the glutes and hamstrings, preventing calf fatigue."
  },
  {
    "muscle_group": "Cardio",
    "exercise_name": "Jump Rope",
    "how_to_do": [
      "Hold the handles lightly with your hands positioned just below your hips.",
      "Rotate the rope smoothly using small, rapid circles with your wrists.",
      "Hop just high enough (1-2 inches) for the rope to clear your feet.",
      "Land softly on the balls of your feet, keeping a slight bend in your knees."
    ],
    "pro_tip": "Keep your elbows pinned tight to your ribs. If your arms flare out, the rope gets shorter and you will constantly trip over it."
  },
  {
    "muscle_group": "Cardio",
    "exercise_name": "Jump Step-up",
    "how_to_do": [
      "Stand facing a highly stable plyo box or bench.",
      "Place one foot flat on the center of the box.",
      "Drive explosively through the elevated foot to launch your entire body into the air.",
      "Switch your legs mid-air, landing softly with the opposite foot on the box."
    ],
    "pro_tip": "Use a forceful upward swing of your arms to generate vertical momentum. The arms dictate the height and speed of the jump."
  },
  {
    "muscle_group": "Cardio",
    "exercise_name": "Jumping Jack",
    "how_to_do": [
      "Stand tall with your feet together and hands resting at your sides.",
      "Simultaneously jump your feet out wider than shoulder-width while swinging your arms overhead.",
      "Jump back to the starting position, bringing your arms back down.",
      "Maintain a continuous, rhythmic bounce."
    ],
    "pro_tip": "Land lightly on the balls of your feet. Flat-footed, heavy landings will send harsh shockwaves straight up your shins and into your knees."
  },
  {
    "muscle_group": "Cardio",
    "exercise_name": "Jumping Jacks",
    "how_to_do": [
      "Stand with feet together, core tight, and eyes looking straight ahead.",
      "Explode your feet outward and clap your hands together above your head.",
      "Snap your feet back together and bring your hands down.",
      "Repeat rapidly for the desired duration to spike your heart rate."
    ],
    "pro_tip": "Keep a micro-bend in your elbows and knees. Locking out your joints completely makes the movement rigid and increases joint wear over high repetitions."
  },
  {
    "muscle_group": "Cardio",
    "exercise_name": "Running",
    "how_to_do": [
      "Maintain a tall posture with a slight forward lean initiating from the ankles, not the waist.",
      "Strike the ground with your mid-foot, ensuring your foot lands directly beneath your center of mass.",
      "Drive your elbows straight back, keeping your arms bent at a 90-degree angle.",
      "Keep your cadence high and your strides relatively short to minimize impact."
    ],
    "pro_tip": "Keep your hands relaxed, as if you are gently holding a potato chip. Clenching your fists sends tension all the way up into your neck and traps."
  },
  {
    "muscle_group": "Cardio",
    "exercise_name": "Stationary Bike",
    "how_to_do": [
      "Adjust the seat height so your leg has a slight 10-degree bend at the absolute bottom of the pedal stroke.",
      "Strap your feet securely into the pedals.",
      "Keep your chest proud and rest your hands lightly on the handlebars.",
      "Pedal with a smooth, circular motion, pulling up on the back half of the stroke as well as pushing down on the front half."
    ],
    "pro_tip": "Do not let your knees cave inward. Keep them tracking perfectly straight like pistons to prevent severe knee tracking injuries over time."
  },
  {
    "muscle_group": "Cardio",
    "exercise_name": "Stretching - Bridge Pose Setu Bandhasana",
    "how_to_do": [
      "Lie on your back, knees bent, with feet flat on the floor close to your glutes.",
      "Keep your arms flat on the floor beside you.",
      "Press through your heels and squeeze your glutes to lift your hips toward the ceiling.",
      "Hold the top position, creating a straight line from your shoulders to your knees."
    ],
    "pro_tip": "Actively press the backs of your shoulders into the mat to open your chest and protect your neck from carrying your bodyweight."
  },
  {
    "muscle_group": "Cardio",
    "exercise_name": "Stretching - Flexion Leg Sit-up",
    "how_to_do": [
      "Lie completely flat on your back on a mat.",
      "Bring one knee up toward your chest and wrap both hands around your shin.",
      "Gently pull the knee closer to your chest while keeping your other leg perfectly straight and pinned to the floor.",
      "Hold the stretch, breathing deeply, then switch legs."
    ],
    "pro_tip": "Keep the back of your head resting on the floor. Yanking your neck up to meet your knee causes cervical strain and takes away from the hip stretch."
  },
  {
    "muscle_group": "Cardio",
    "exercise_name": "Stretching - Front Toe Touch",
    "how_to_do": [
      "Stand tall with your feet together and legs straight.",
      "Hinge at your hips, pushing your glutes backward while keeping your back as flat as possible.",
      "Let your arms hang down and reach for your toes or the floor.",
      "Hold the position when you feel a strong stretch in your hamstrings."
    ],
    "pro_tip": "Never bounce up and down to reach further. Bouncing triggers the stretch reflex, which actually makes the muscle tighten up to protect itself."
  },
  {
    "muscle_group": "Cardio",
    "exercise_name": "Stretching - Plyo Side Lunge Stretch",
    "how_to_do": [
      "Take a very wide stance with your toes pointing straight forward.",
      "Shift your weight to your right side, bending the right knee and pushing your hips back.",
      "Keep your left leg completely straight to feel a deep stretch in the inner thigh (adductor).",
      "Push off the bent leg to return to the center, then smoothly transition to the left side."
    ],
    "pro_tip": "Keep the heel of your bent leg firmly glued to the floor. If your heel lifts up, you need to widen your stance or stop dropping so low."
  },
  {
    "muscle_group": "Cardio",
    "exercise_name": "Stretching - Single Leg Stretch (bent knee)",
    "how_to_do": [
      "Sit on the floor and extend one leg straight out in front of you.",
      "Bend your other knee and place the sole of that foot flat against the inner thigh of your extended leg.",
      "Sit tall, square your shoulders to the straight leg, and hinge forward from the hips.",
      "Reach toward your toes and hold the stretch."
    ],
    "pro_tip": "Focus on bringing your belly button to your thigh, not your nose to your knee. This ensures a flat back and a true hamstring stretch."
  },
  {
    "muscle_group": "Cardio",
    "exercise_name": "Stretching - Single Straight Leg Stretch",
    "how_to_do": [
      "Lie flat on your back on a comfortable mat.",
      "Lift one leg straight up toward the ceiling.",
      "Reach up and grab the back of your calf or hamstring with both hands.",
      "Gently pull the straight leg toward your face while keeping the non-working leg flat on the floor."
    ],
    "pro_tip": "Actively flex the quad muscle of your raised leg. This concept (reciprocal inhibition) signals the opposing hamstring muscle to relax and stretch further."
  },
  {
    "muscle_group": "Cardio",
    "exercise_name": "Treadmill Run",
    "how_to_do": [
      "Straddle the treadmill belt by standing on the side rails.",
      "Start the machine at a slow walking speed, then carefully step onto the belt.",
      "Gradually increase the speed and incline to your desired intensity.",
      "Run with a tall posture and natural arm swing."
    ],
    "pro_tip": "Run in the middle of the belt. Hugging the front console forces you to shorten your natural stride, which throws off your biomechanics."
  },
  {
    "muscle_group": "Cardio",
    "exercise_name": "Treadmill Running",
    "how_to_do": [
      "Begin with a 3-5 minute warm-up walk or light jog to prepare your joints.",
      "Increase the speed to your target running pace.",
      "Keep your eyes focused straight ahead, not down at the console.",
      "To finish, do not jump off a moving belt; lower the speed slowly to a walk for a 2-minute cool-down."
    ],
    "pro_tip": "Set the treadmill to a 1% incline. Because there is no wind resistance indoors, a 1% incline perfectly mimics the energy cost of running flat outdoors."
  },
  {
    "muscle_group": "Cardio",
    "exercise_name": "Walk Wave Machine",
    "how_to_do": [
      "Step onto the foot platforms and select your program on the console.",
      "Begin a walking or climbing motion, pressing the pedals down and back.",
      "Keep your torso upright and your core engaged.",
      "Use the handrails lightly for balance, not to support your bodyweight."
    ],
    "pro_tip": "Take deep, full strides. Short, choppy steps rob you of the glute and hamstring engagement that makes this machine so effective."
  },

  // ── Chest ─────────────────────────────────────────────────────────────────
  {
    "muscle_group": "Chest",
    "exercise_name": "Band High Fly",
    "how_to_do": [
      "Anchor a resistance band high above your head.",
      "Stand facing away from the anchor, grip the bands, and step forward.",
      "With a slight bend in your elbows, bring your hands together in a downward arcing motion toward your waist.",
      "Focus on squeezing your chest muscles at the bottom, then slowly return to the starting position."
    ],
    "pro_tip": "Think about bringing your biceps together rather than your hands. This small mental cue forces the chest to contract fully instead of letting your shoulders do the heavy lifting."
  },
  {
    "muscle_group": "Chest",
    "exercise_name": "Barbell Bench Press",
    "how_to_do": [
      "Lie flat on the bench, feet planted firmly on the floor.",
      "Grip the bar slightly wider than shoulder-width.",
      "Lower the bar to your mid-chest under control.",
      "Press the bar back up to the starting position, keeping your shoulder blades retracted and chest puffed."
    ],
    "pro_tip": "Keep your elbows tucked at a 45-degree angle from your body. Flaring them out to 90 degrees is the #1 cause of rotator cuff injuries in this movement."
  },
  {
    "muscle_group": "Chest",
    "exercise_name": "Cable Crossover",
    "how_to_do": [
      "Set pulleys at or above shoulder height.",
      "Stand in the center, step forward, and bring the handles together in front of your chest.",
      "Maintain a slight bend in your elbows throughout the entire movement.",
      "Focus on the deep stretch as you return to the starting position."
    ],
    "pro_tip": "Cross your hands over each other at the bottom of the movement to achieve a deeper contraction across the inner chest fibers."
  },
  {
    "muscle_group": "Chest",
    "exercise_name": "Cable Lying Fly, Flat Bench Cable Fly",
    "how_to_do": [
      "Place a bench in the center of the cable crossover station.",
      "Lie back and grab the low-pulley handles.",
      "With a fixed bend in your elbows, arc your arms up and together until your hands meet above your chest.",
      "Lower back down slowly, feeling the stretch in your pectorals."
    ],
    "pro_tip": "Maintain the exact same degree of elbow bend for every repetition. If your arms straighten out, you are turning a chest fly into a press."
  },
  {
    "muscle_group": "Chest",
    "exercise_name": "Cable Pullover",
    "how_to_do": [
      "Set a cable pulley to a high position.",
      "Lie on a bench with your head near the cable machine, holding the handle with straight arms overhead.",
      "Keeping your arms straight, arc the handle down toward your thighs.",
      "Reverse the motion slowly, keeping tension on the lats and chest throughout."
    ],
    "pro_tip": "The pullover is an excellent 'finish' exercise. Keep your core tight and back flat against the bench to prevent your lumbar spine from arching."
  },
  {
    "muscle_group": "Chest",
    "exercise_name": "Cable Standing Fly, Crossover fly",
    "how_to_do": [
      "Set the pulleys to chest height.",
      "Step forward to create tension, chest out, and shoulders back.",
      "Press the cables together in front of your body in a hugging motion.",
      "Return to the start slowly, focusing on the stretch."
    ],
    "pro_tip": "Do not let your shoulders round forward as you bring the cables together. Keep your shoulder blades retracted against the bench or air to keep the chest engaged."
  },
  {
    "muscle_group": "Chest",
    "exercise_name": "Chest Dip",
    "how_to_do": [
      "Grip the parallel bars, and support your weight with straight arms.",
      "Lean your torso forward significantly, letting your elbows flare slightly to the sides.",
      "Lower your body until your chest feels a stretch.",
      "Push back up to the start, focusing the effort on your chest, not your triceps."
    ],
    "pro_tip": "The key to hitting the chest in a dip is the forward lean. If you stay completely vertical, you are performing a triceps dip, not a chest dip."
  },
  {
    "muscle_group": "Chest",
    "exercise_name": "Close-Grip Bench Press",
    "how_to_do": [
      "Lie on the bench and grip the barbell with your hands closer than shoulder-width.",
      "Lower the bar to the middle of your chest.",
      "Press back up, keeping elbows tucked close to your torso.",
      "Focus the tension on the triceps and inner chest."
    ],
    "pro_tip": "Ensure your wrists stay straight. Letting the barbell roll back into your palms can cause severe wrist strain when using a narrow grip."
  },
  {
    "muscle_group": "Chest",
    "exercise_name": "Decline Barbell Bench Press",
    "how_to_do": [
      "Secure your feet on a decline bench and lie back.",
      "Lower the barbell to the lower part of your chest.",
      "Press the weight up, maintaining a stable position on the bench.",
      "Focus on the lower pectoral fibers."
    ],
    "pro_tip": "Because you are on a decline, the bar path should be slightly different than a flat bench—aim for a straight line up and down directly over your lower sternum."
  },
  {
    "muscle_group": "Chest",
    "exercise_name": "Decline Dumbbell Bench Press (45 degree)",
    "how_to_do": [
      "Lie on a decline bench, holding dumbbells over your chest.",
      "Lower the weights to the sides of your lower chest.",
      "Press back up to the start, maintaining control.",
      "Focus on lower chest hypertrophy."
    ],
    "pro_tip": "Dumbbells allow for a greater range of motion than a barbell. Go as deep as your shoulders comfortably allow to maximize chest stretch."
  },
  {
    "muscle_group": "Chest",
    "exercise_name": "Deep Push-ups",
    "how_to_do": [
      "Place your hands on elevated surfaces (like yoga blocks or books) to increase the range of motion.",
      "Perform a standard push-up, dropping your chest below the level of your hands.",
      "Push back to the start.",
      "Maintain a rigid body throughout."
    ],
    "pro_tip": "The 'deep' part of the movement is where the growth happens. If you cannot maintain perfect form at the bottom, remove the blocks."
  },
  {
    "muscle_group": "Chest",
    "exercise_name": "Dumbbell Bench Press",
    "how_to_do": [
      "Lie on the bench with a dumbbell in each hand at chest level.",
      "Press the weights up until your arms are locked out.",
      "Lower them slowly back down, allowing the dumbbells to stretch the chest at the bottom.",
      "Focus on a controlled, uniform movement."
    ],
    "pro_tip": "Rotate your hands slightly so your palms face more toward each other as you press. This is much easier on the shoulder joint than a fixed barbell grip."
  },
  {
    "muscle_group": "Chest",
    "exercise_name": "Dumbbell Fly",
    "how_to_do": [
      "Lie on the bench with dumbbells held over your chest.",
      "With a slight bend in your elbows, lower the weights in a wide arc until your chest is stretched.",
      "Bring the weights back together at the top, squeezing your pecs.",
      "Focus on the controlled, wide movement."
    ],
    "pro_tip": "Imagine you are hugging a giant tree. This helps maintain the correct elbow bend throughout the movement."
  },
  {
    "muscle_group": "Chest",
    "exercise_name": "Dumbbell Incline Bench Press",
    "how_to_do": [
      "Set the bench to a 30-45 degree incline.",
      "Press the dumbbells from shoulder height up above your chest.",
      "Lower back down under control.",
      "Target the upper portion of the pectorals."
    ],
    "pro_tip": "If you set the bench too high (e.g., 60 degrees), the work shifts primarily to your shoulders. Stick to 30-45 degrees to keep the focus on the upper chest."
  },
  {
    "muscle_group": "Chest",
    "exercise_name": "Dumbbell Incline Fly",
    "how_to_do": [
      "On an inclined bench, hold the dumbbells over your chest.",
      "Lower in a wide arc until a stretch is felt.",
      "Return to the top, squeezing the upper pecs.",
      "Ensure controlled movement."
    ],
    "pro_tip": "Always maintain the same slight bend in your elbows. Straightening your arms at the bottom turns this into a high-risk move for your bicep tendons."
  },
  {
    "muscle_group": "Chest",
    "exercise_name": "Hammer Strength Chest Press",
    "how_to_do": [
      "Adjust the seat so the handles are in line with the middle of your chest.",
      "Push the handles out, focusing on squeezing your chest.",
      "Lower back slowly, keeping shoulder blades tucked.",
      "This is a machine-based, safe way to build muscle."
    ],
    "pro_tip": "Because the machine guides the path, focus purely on the contraction. Squeeze your pecs for a second at full extension to increase intensity."
  },
  {
    "muscle_group": "Chest",
    "exercise_name": "Incline Barbell Bench Press",
    "how_to_do": [
      "Set the bench at a 30-45 degree angle.",
      "Lower the bar to your upper chest.",
      "Press up until arms are extended.",
      "Target the clavicular (upper) head of the pecs."
    ],
    "pro_tip": "Control the descent! Lowering the bar too fast is a recipe for shoulder injuries on an incline."
  },
  {
    "muscle_group": "Chest",
    "exercise_name": "Incline Push-Ups",
    "how_to_do": [
      "Place your hands on a raised surface like a bench or step.",
      "Keep your body in a straight line and lower your chest to the bench.",
      "Push back up to the start.",
      "A great way to scale the intensity."
    ],
    "pro_tip": "The higher the bench, the easier the push-up. Use this to focus on form before progressing to floor or decline push-ups."
  },
  {
    "muscle_group": "Chest",
    "exercise_name": "Lever Chest Press",
    "how_to_do": [
      "Adjust the seat height so handles are mid-chest.",
      "Drive the handles forward, squeezing the chest.",
      "Slowly return, keeping the shoulders back.",
      "Focus on clean, steady repetition."
    ],
    "pro_tip": "Focus on driving your elbows together as you push. This simple cue ensures you are using your chest rather than just your shoulders."
  },
  {
    "muscle_group": "Chest",
    "exercise_name": "Machine Chest Press",
    "how_to_do": [
      "Adjust the seat so the handles align with your middle chest.",
      "Push forward steadily.",
      "Return slowly, ensuring a full range of motion.",
      "Keep your back firmly against the pad."
    ],
    "pro_tip": "Machine presses are perfect for drop sets. Since there's no balance needed, you can push yourself to failure without worrying about dropping the weight."
  },
  {
    "muscle_group": "Chest",
    "exercise_name": "Pec Deck Machine",
    "how_to_do": [
      "Sit back, place your forearms on the pads.",
      "Bring your hands together in front of your chest.",
      "Squeeze, then return slowly to the stretched position.",
      "An excellent isolation movement."
    ],
    "pro_tip": "Keep your head and back firmly against the pad. If you are leaning forward to assist the movement, you are cheating yourself out of gains."
  },
  {
    "muscle_group": "Chest",
    "exercise_name": "Push Up",
    "how_to_do": [
      "Start in a plank position, hands shoulder-width apart.",
      "Lower your body until your chest almost touches the floor.",
      "Push back up to the start.",
      "Keep your core and glutes tight."
    ],
    "pro_tip": "Imagine you are 'screwing' your hands into the floor. This generates external rotation torque in your shoulders, making the movement much more stable and effective."
  },
  {
    "muscle_group": "Chest",
    "exercise_name": "Reverse-Grip Bench Press",
    "how_to_do": [
      "Lie on the bench and use a reverse (underhand) grip on the barbell.",
      "Lower the bar to your chest, elbows tucked closely to your sides.",
      "Press the bar up.",
      "An advanced movement for upper chest development."
    ],
    "pro_tip": "Start with much lighter weight than your standard bench press. This grip changes the physics significantly."
  },
  {
    "muscle_group": "Chest",
    "exercise_name": "Standing One-Arm Cable Press",
    "how_to_do": [
      "Stand in the center of the cable station, facing away from the machine.",
      "Hold one handle, arm bent at 90 degrees.",
      "Press the cable forward.",
      "Controlled return."
    ],
    "pro_tip": "This exercise is all about anti-rotation. Your core must work overtime to keep your torso stable while your arm pushes the weight."
  },
  {
    "muscle_group": "Chest",
    "exercise_name": "Stretching - Dynamic Chest Stretch",
    "how_to_do": [
      "Stand in a doorway, placing your forearms on the door frame with elbows at 90 degrees.",
      "Gently lean forward until you feel a stretch in your chest.",
      "Step back, then repeat.",
      "Perform consistently for mobility."
    ],
    "pro_tip": "Change the height of your arms on the door frame to target different angles of your pectoral muscle."
  },
  {
    "muscle_group": "Chest",
    "exercise_name": "Triceps Dips",
    "how_to_do": [
      "Grip parallel bars, support your weight.",
      "Lower yourself until elbows are at 90 degrees.",
      "Press back up.",
      "Focus on vertical movement."
    ],
    "pro_tip": "Keep your body as vertical as possible to prioritize triceps over the chest."
  },
  {
    "muscle_group": "Chest",
    "exercise_name": "Wide Grip Push-ups",
    "how_to_do": [
      "Place your hands significantly wider than shoulder-width.",
      "Perform a standard push-up, focusing on the chest stretch at the bottom.",
      "Push back to the start.",
      "A great way to widen the focus."
    ],
    "pro_tip": "Avoid going too wide (like 2x shoulder width). This creates unnecessary strain on the shoulder capsule without significantly more chest benefit."
  },

  // ── Core/Abs ──────────────────────────────────────────────────────────────
  {
    "muscle_group": "Core/Abs",
    "exercise_name": "45 Degree Bycicle Twisting Crunch",
    "how_to_do": [
      "Lie flat on your back, place your hands lightly behind your head, and raise your legs to a 45-degree angle.",
      "Crunch your upper body off the floor and twist your torso to bring your right elbow toward your left knee, while bringing the knee in.",
      "Extend the left leg back out to 45 degrees while simultaneously twisting to bring your left elbow to your right knee.",
      "Continue alternating sides in a smooth, pedaling motion."
    ],
    "pro_tip": "Keep your lower back pressed firmly into the floor at all times. If your back begins to arch, raise your legs slightly higher into the air to protect your spine."
  },
  {
    "muscle_group": "Core/Abs",
    "exercise_name": "45 Degree Side Bend",
    "how_to_do": [
      "Secure your feet in a 45-degree hyperextension bench, positioning your body so you are resting on your side.",
      "Cross your arms over your chest or lightly behind your head.",
      "Lower your torso down toward the floor until you feel a stretch in your obliques.",
      "Contract your core to pull your torso back up to a straight line."
    ],
    "pro_tip": "Focus on a pure lateral (sideways) crunch. Do not let your torso twist forward or backward as you bend, which shifts the work away from the obliques."
  },
  {
    "muscle_group": "Core/Abs",
    "exercise_name": "Air Twisting Crunch",
    "how_to_do": [
      "Lie on your back with your knees bent and feet flat on the floor.",
      "Place your hands lightly behind your ears.",
      "Crunch your upper body upward and twist your torso to reach one hand across your body toward the opposite knee.",
      "Return smoothly to the floor and repeat the twisting motion on the other side."
    ],
    "pro_tip": "Lead with your shoulder, not your elbow or hand. This ensures the rotation comes directly from your oblique muscles rather than your neck."
  },
  {
    "muscle_group": "Core/Abs",
    "exercise_name": "Band Decline Sit-ups",
    "how_to_do": [
      "Secure your feet at the top of a decline bench.",
      "Hold a resistance band anchored securely behind the bench, keeping it at chest height.",
      "Slowly lower your torso back until it is parallel to the floor.",
      "Flex your abs to sit all the way back up, fighting the band's tension the entire way."
    ],
    "pro_tip": "Exhale completely as you sit up. Emptying your lungs gives your abdominal muscles room to contract significantly harder at the top of the movement."
  },
  {
    "muscle_group": "Core/Abs",
    "exercise_name": "Band Side Bend",
    "how_to_do": [
      "Stand on one end of a resistance band and hold the other end in your hand down by your side.",
      "Keep your chest up and bend your torso straight down toward the hand holding the band.",
      "Use your opposite oblique to pull your torso back up to a perfectly vertical position.",
      "Repeat for reps, then switch sides."
    ],
    "pro_tip": "Keep your hips completely frozen in place. The only joint that should be moving is your spine bending side to side."
  },
  {
    "muscle_group": "Core/Abs",
    "exercise_name": "Band Standing Crunch",
    "how_to_do": [
      "Anchor a resistance band high above you and hold an end in each hand behind your neck.",
      "Stand tall, plant your feet shoulder-width apart, and brace your core.",
      "Crunch your torso forward and down, attempting to bring your ribs toward your pelvis.",
      "Squeeze your abs hard at the bottom, then slowly return to standing."
    ],
    "pro_tip": "Focus on actually curling and shortening your spine. If you just bow forward with a flat back, you are working your hips, not your abs."
  },
  {
    "muscle_group": "Core/Abs",
    "exercise_name": "Band Standing Lift",
    "how_to_do": [
      "Anchor a resistance band to a low point next to your foot.",
      "Stand sideways to the anchor, grab the band with both hands, and keep your arms straight.",
      "Twist your torso to lift the band diagonally upward and across your body, finishing above your opposite shoulder.",
      "Control the band as you slowly reverse the motion back to the low starting point."
    ],
    "pro_tip": "Pivot your trailing foot as you twist upward, exactly like swinging a baseball bat. This protects your knee joint and allows you to generate maximum rotational power."
  },
  {
    "muscle_group": "Core/Abs",
    "exercise_name": "Band Twist",
    "how_to_do": [
      "Anchor a band at chest height and stand sideways to it.",
      "Grip the band with both hands and hold it straight out in front of your chest.",
      "Keeping your arms perfectly straight, rotate your torso horizontally away from the anchor point.",
      "Slowly let the band pull you back to the center under control."
    ],
    "pro_tip": "Lock your hips so they face straight forward the entire time (headlights on a car). The rotation should happen entirely in your thoracic spine and obliques."
  },
  {
    "muscle_group": "Core/Abs",
    "exercise_name": "Band Twist (Up-down)",
    "how_to_do": [
      "Anchor a band high above you and stand sideways to the anchor point.",
      "Grab the band with both hands and pull it diagonally down and across your body toward your opposite knee.",
      "Contract your core at the bottom of the chopping motion.",
      "Resist the band as it pulls your arms back up to the starting position."
    ],
    "pro_tip": "Do not let the band snap back up! The eccentric (return) phase builds just as much oblique strength and control as the downward pull."
  },
  {
    "muscle_group": "Core/Abs",
    "exercise_name": "Bench Leg Raise",
    "how_to_do": [
      "Lie flat on a bench so your glutes are at the very edge and your legs are extended out in the air.",
      "Reach back and grab the bench behind your head for stability.",
      "Keeping your legs straight, raise them up until they point toward the ceiling.",
      "Slowly lower them until they are just parallel to the floor."
    ],
    "pro_tip": "Do not let your legs drop below the level of the bench. Going lower hyperextends the lower back and shifts the tension away from the abs dangerously."
  },
  {
    "muscle_group": "Core/Abs",
    "exercise_name": "Bent Knee Lying Twist",
    "how_to_do": [
      "Lie on your back with your arms extended out to the sides in a T-shape.",
      "Bend your knees to 90 degrees and lift them up so they hover directly over your hips.",
      "Slowly drop both knees to one side without letting them rest on the floor.",
      "Use your core to pull your knees back to the center, then drop them to the other side."
    ],
    "pro_tip": "Keep both of your shoulder blades glued to the floor. If the opposite shoulder lifts off the ground, you have twisted too far."
  },
  {
    "muscle_group": "Core/Abs",
    "exercise_name": "Cable Kneeling Crunch",
    "how_to_do": [
      "Attach a rope to a high cable pulley.",
      "Kneel facing the machine, grab the rope, and place your hands behind your head or next to your ears.",
      "Crunch your torso forward and down, bringing your elbows toward your thighs.",
      "Pause for a deep squeeze, then slowly return to an upright kneeling position."
    ],
    "pro_tip": "Do not sit back onto your heels as you crunch. Lock your hips in place to ensure the abdominal wall does all the pulling, rather than your hip flexors."
  },
  {
    "muscle_group": "Core/Abs",
    "exercise_name": "Cable Standing Lift",
    "how_to_do": [
      "Attach a standard handle to a low cable pulley.",
      "Stand sideways to the machine, grip the handle with both hands, and keep your arms straight.",
      "Rotate your torso to lift the cable diagonally across your body and upward above your opposite shoulder.",
      "Lower the weight back down slowly, keeping constant tension."
    ],
    "pro_tip": "Keep your arms as straight as possible throughout the movement. Bending your elbows turns this into an arm exercise rather than a core twist."
  },
  {
    "muscle_group": "Core/Abs",
    "exercise_name": "Cable Twist (up-down)",
    "how_to_do": [
      "Set a cable pulley to the highest position and attach a standard handle or rope.",
      "Stand sideways to the machine and grab the handle with both hands.",
      "Chop the weight diagonally down across your body toward your opposite knee.",
      "Slowly reverse the motion to let the handle return to the top."
    ],
    "pro_tip": "Exhale sharply as you chop downward. This forces you to brace your core and significantly increases the intensity of the contraction."
  },
  {
    "muscle_group": "Core/Abs",
    "exercise_name": "Crunch",
    "how_to_do": [
      "Lie on your back with your knees bent and feet flat on the floor.",
      "Place your fingertips lightly behind your ears.",
      "Contract your abdominal muscles to lift your shoulder blades off the floor.",
      "Hold the contraction for a second, then slowly lower your shoulder blades back down."
    ],
    "pro_tip": "Pick a spot on the ceiling directly above you and stare at it. Looking forward at your knees will cause you to pull on your neck."
  },
  {
    "muscle_group": "Core/Abs",
    "exercise_name": "Crunch (on bench)",
    "how_to_do": [
      "Lie on a flat bench with your knees bent and your feet placed flat on the bench itself.",
      "Cross your arms tightly over your chest.",
      "Squeeze your abs to curl your upper body forward, raising your shoulder blades.",
      "Lower your torso back down to the bench smoothly."
    ],
    "pro_tip": "Placing your feet flat on the bench naturally flattens your lower spine against the pad, isolating the upper abdominals far more effectively than keeping your feet on the floor."
  },
  {
    "muscle_group": "Core/Abs",
    "exercise_name": "Dumbbell Side Bend",
    "how_to_do": [
      "Stand tall with your feet shoulder-width apart, holding a single dumbbell in one hand down by your side.",
      "Keep your chest up and bend your torso sideways toward the dumbbell.",
      "Use the oblique on the opposite side to pull your torso back up to a straight, vertical line.",
      "Finish your reps on one side, then switch."
    ],
    "pro_tip": "Only hold ONE dumbbell at a time! Holding a dumbbell in each hand counterbalances the weight and completely ruins the effectiveness of the exercise."
  },
  {
    "muscle_group": "Core/Abs",
    "exercise_name": "Hanging Knee Raise",
    "how_to_do": [
      "Hang from a pull-up bar with an overhand grip, arms fully extended.",
      "Brace your core to stop any swinging.",
      "Pull your knees upward toward your chest as high as you can.",
      "Lower your knees back to the starting position with strict control."
    ],
    "pro_tip": "At the very top of the movement, actively tilt your pelvis forward (tuck your tailbone up). Just lifting your knees works your hip flexors; rolling the pelvis engages the lower abs."
  },
  {
    "muscle_group": "Core/Abs",
    "exercise_name": "Hanging Leg Hip Raise",
    "how_to_do": [
      "Hang from a pull-up bar with straight arms.",
      "Keeping your legs straight, raise them until they are parallel to the floor (90 degrees).",
      "From that 90-degree position, push your hips slightly upward to crunch the lower abs.",
      "Slowly lower your legs all the way back down."
    ],
    "pro_tip": "Press your lats down hard to stabilize your body. If you are swinging back and forth like a pendulum, you lose all tension on the core."
  },
  {
    "muscle_group": "Core/Abs",
    "exercise_name": "Hanging Leg Raise",
    "how_to_do": [
      "Hang from a bar with a shoulder-width grip and your legs hanging straight down.",
      "Contract your core to lift your feet out in front of you until your legs are parallel to the floor.",
      "Pause for a second at the top of the movement.",
      "Lower your legs back to a dead hang without swinging."
    ],
    "pro_tip": "If your hamstrings are tight, maintaining perfectly straight legs will be impossible. A slight bend in the knees is perfectly fine—focus on the core contraction, not the leg stretch."
  },
  {
    "muscle_group": "Core/Abs",
    "exercise_name": "Hanging Straight Leg Raise",
    "how_to_do": [
      "Hang from a pull-up bar with straight arms.",
      "Keeping your legs completely straight, use your core to lift your feet as high as possible, ideally tapping the bar above you.",
      "Lower your legs back down incredibly slowly to fight momentum.",
      "Stop completely at the bottom before initiating the next rep."
    ],
    "pro_tip": "Initiate this elite-level movement by aggressively pulling your ribs down toward your pelvis, rather than just swinging your feet upward."
  },
  {
    "muscle_group": "Core/Abs",
    "exercise_name": "Incline Leg Hip Raise",
    "how_to_do": [
      "Lie back on an incline bench and grab the handle or the top of the bench behind your head.",
      "Keep your legs straight and raise them toward the ceiling.",
      "As your legs reach the top, thrust your hips off the bench by contracting your lower abs.",
      "Slowly lower your hips, then your legs, back to the starting position."
    ],
    "pro_tip": "The \"hip thrust\" at the very top is the absolute most important part of the exercise for engaging the lower abdominals. Do not skip it!"
  },
  {
    "muscle_group": "Core/Abs",
    "exercise_name": "Landmine 180",
    "how_to_do": [
      "Hold the loaded end of a landmine barbell with both hands directly in front of your chest.",
      "Keep your arms nearly straight and pivot your torso to drop the barbell down to one side.",
      "Explosively swing the barbell in a large arc over to the opposite side of your body.",
      "Absorb the weight on the descent, then immediately swing it back."
    ],
    "pro_tip": "Move the weight using your core, not your arms. Keep your elbows locked and pivot your feet with the movement to generate rotational power."
  },
  {
    "muscle_group": "Core/Abs",
    "exercise_name": "Leg Raise",
    "how_to_do": [
      "Lie flat on your back with your legs straight and place your hands flat under your glutes for support.",
      "Keeping your legs completely straight, raise them until they point directly at the ceiling.",
      "Slowly lower them until your heels hover just an inch above the floor.",
      "Raise them back up immediately to maintain tension."
    ],
    "pro_tip": "Never let your lower back arch entirely off the floor. If you feel it lifting, do not lower your legs quite as far to the ground."
  },
  {
    "muscle_group": "Core/Abs",
    "exercise_name": "Lever Seated Crunch",
    "how_to_do": [
      "Sit in the ab crunch machine, tuck your feet under the lower pads, and grab the upper handles.",
      "Contract your abdominals to crunch your upper body forward and pull your knees upward simultaneously.",
      "Pause and squeeze your core at the peak contraction.",
      "Slowly return to the starting position without letting the weight stack touch down."
    ],
    "pro_tip": "Focus on rounding your spine like a \"C\" as you pull the handles down. If you just hinge forward with a flat back, you miss the abdominal contraction entirely."
  },
  {
    "muscle_group": "Core/Abs",
    "exercise_name": "Lever Seated Leg Raise Crunch",
    "how_to_do": [
      "Sit in the machine, securing your upper body firmly against the backrest.",
      "Hook your legs over the lower lever pads.",
      "Use your lower abs to pull the leg lever up toward your chest.",
      "Lower the lever back down with a slow, controlled tempo."
    ],
    "pro_tip": "Pause for a full second when your knees are pulled into your chest. This eliminates momentum and maximizes time under tension on the stubborn lower abs."
  },
  {
    "muscle_group": "Core/Abs",
    "exercise_name": "Lying Floor Leg Raise",
    "how_to_do": [
      "Lie flat on your back, legs straight, and arms resting firmly by your sides.",
      "Lift both legs up until they are perpendicular to the floor.",
      "Slowly lower them back down over a 3-second count.",
      "Stop just before your heels touch the floor, then lift again."
    ],
    "pro_tip": "Press your palms and forearms actively into the floor. This provides immense upper body stability, allowing you to focus 100% of your mental energy on the lower abs."
  },
  {
    "muscle_group": "Core/Abs",
    "exercise_name": "Lying Straight Leg Raise",
    "how_to_do": [
      "Lie on the floor with your legs perfectly straight and together.",
      "Contract your core to lift your straight legs to a 90-degree angle.",
      "Control the descent, keeping your knees locked.",
      "Maintain abdominal tension at the bottom before starting the next rep."
    ],
    "pro_tip": "Point your toes slightly outward as you perform the raise. This subtle external rotation takes the hip flexors out of the movement and hits the lower abs much harder."
  },
  {
    "muscle_group": "Core/Abs",
    "exercise_name": "Otis-ups",
    "how_to_do": [
      "Lie on your back with your knees bent and feet flat on the floor.",
      "Hold a weight plate flat against your chest.",
      "Perform a full sit-up, and as you reach the top, press the weight plate straight overhead.",
      "Lower the weight back to your chest as you roll your spine back down to the floor."
    ],
    "pro_tip": "Keep your heels planted firmly on the floor. If they lift up, you are using momentum and rocking rather than using your core to rise."
  },
  {
    "muscle_group": "Core/Abs",
    "exercise_name": "Plank",
    "how_to_do": [
      "Get into a push-up position, but rest your weight on your forearms instead of your hands.",
      "Keep your body in a perfectly straight line from your head to your heels.",
      "Squeeze your glutes tight and brace your core.",
      "Hold this rigid position for the target time without letting your hips sag."
    ],
    "pro_tip": "Don't just casually survive the time—actively try to drag your elbows toward your toes (without actually moving them). This creates an intense, full-body isometric contraction."
  },
  {
    "muscle_group": "Core/Abs",
    "exercise_name": "Russian Twist",
    "how_to_do": [
      "Sit on the floor, lean back slightly, and lift your feet off the ground so you are balancing on your sit bones.",
      "Hold a dumbbell or medicine ball with both hands at chest level.",
      "Twist your torso to tap the weight on the floor beside your right hip, then twist to tap it by your left hip.",
      "Keep your core braced and legs as still as possible."
    ],
    "pro_tip": "Follow the weight with your eyes as you twist. This mental cue forces your entire upper torso to rotate, ensuring maximum engagement of the obliques."
  },
  {
    "muscle_group": "Core/Abs",
    "exercise_name": "Side Bridge - Side Plank",
    "how_to_do": [
      "Lie on your side and prop your upper body up on your forearm, ensuring your elbow is directly under your shoulder.",
      "Stack your feet directly on top of each other.",
      "Lift your hips off the floor until your body forms a perfectly straight line.",
      "Hold this rigid position, breathing normally."
    ],
    "pro_tip": "Actively push the floor away with your forearm. This keeps your shoulder packed and stable, preventing your hips from sagging toward the floor."
  },
  {
    "muscle_group": "Core/Abs",
    "exercise_name": "Sit Up",
    "how_to_do": [
      "Lie on your back with your knees bent and feet flat on the floor.",
      "Cross your arms securely over your chest.",
      "Engage your core to sit all the way up until your chest is near your thighs.",
      "Slowly unroll your spine back down to the floor."
    ],
    "pro_tip": "Avoid anchoring your feet under a heavy object if possible. Anchoring the feet shifts the primary workload away from the abs and directly into the hip flexors."
  },
  {
    "muscle_group": "Core/Abs",
    "exercise_name": "Sit-up On Exercise Ball",
    "how_to_do": [
      "Sit on a stability ball and slowly walk your feet forward until your lower back is fully supported by the curve of the ball.",
      "Cross your arms over your chest and lean back to get a deep abdominal stretch.",
      "Crunch your torso upward, contracting your abs.",
      "Slowly lean back to return to the stretched position."
    ],
    "pro_tip": "The exercise ball allows for a much greater range of motion than the floor. Focus on the deep stretch at the bottom to recruit maximum muscle fibers."
  },
  {
    "muscle_group": "Core/Abs",
    "exercise_name": "Sit-ups",
    "how_to_do": [
      "Lie on the floor with your knees bent and your fingertips placed lightly behind your ears.",
      "Contract your abdominals to curl your torso up into a seated position.",
      "Lower your body back down in a smooth, controlled motion.",
      "Do not let your upper back rest fully on the ground between reps."
    ],
    "pro_tip": "Never interlock your fingers behind your neck! Pulling on the back of your head during a sit-up is a guaranteed way to cause severe cervical spine strain."
  },
  {
    "muscle_group": "Core/Abs",
    "exercise_name": "Spell Caster",
    "how_to_do": [
      "Stand holding a dumbbell in each hand, keeping your arms relatively straight in front of you.",
      "Swing both dumbbells down to the outside of your right hip.",
      "Explosively swing the dumbbells in an arc across your body up to your left shoulder, like casting a spell.",
      "Reverse the motion back down to your hip."
    ],
    "pro_tip": "Keep your core rigidly braced. The entire goal of this exercise is to force your abs and obliques to resist the rotational force of the swinging dumbbells."
  },
  {
    "muscle_group": "Core/Abs",
    "exercise_name": "Standing Ab Wheel Rollout",
    "how_to_do": [
      "Stand holding an ab wheel and bend at the waist to place the wheel on the floor in front of you.",
      "Slowly roll the wheel forward, extending your body out as far as you can without your back sagging.",
      "Contract your core to pull the wheel back to your feet, returning to a standing hinge position."
    ],
    "pro_tip": "This is an elite-level core movement. If your lower back arches or hurts at any point, stop immediately. Master the kneeling ab wheel rollout completely before attempting this."
  },
  {
    "muscle_group": "Core/Abs",
    "exercise_name": "Standing Cable Crunch",
    "how_to_do": [
      "Attach a triceps rope to a high cable pulley.",
      "Stand facing away from the machine, holding the rope ends securely behind your neck.",
      "Crunch your torso forward and down, contracting your abs forcefully.",
      "Slowly return to the upright standing position, resisting the weight stack."
    ],
    "pro_tip": "Keep your hips locked firmly in place. If your hips move backward as you bow forward, you are turning it into a lower-back exercise rather than an ab crunch."
  },
  {
    "muscle_group": "Core/Abs",
    "exercise_name": "Stretching - Chin-to-chest Stretch",
    "how_to_do": [
      "Sit or stand tall with completely relaxed shoulders.",
      "Slowly drop your chin straight down toward your chest.",
      "Hold the position until you feel a gentle stretch in the back of your neck and upper spine.",
      "Hold for 20-30 seconds, then slowly raise your head."
    ],
    "pro_tip": "Do not force or pull your head down with your hands. Allow the natural weight of your head to provide the stretch to prevent straining delicate neck muscles."
  },
  {
    "muscle_group": "Core/Abs",
    "exercise_name": "Stretching - Iron Cross Stretch",
    "how_to_do": [
      "Lie flat on your back with your arms extended straight out to the sides in a T-shape.",
      "Lift your right leg straight up, then let it drop across your body toward your left hand.",
      "Hold the stretch in your lower back and hip for 30 seconds.",
      "Return to the center and switch legs."
    ],
    "pro_tip": "Keep both of your shoulder blades glued to the floor. The stretch must come from the rotation of the lower spine, not from rolling your upper body."
  },
  {
    "muscle_group": "Core/Abs",
    "exercise_name": "Stretching - Seated Twist (straight arm)",
    "how_to_do": [
      "Sit on the floor with your legs straight out in front of you.",
      "Bend your right knee and step your right foot over your left leg, planting it on the floor.",
      "Place your left elbow on the outside of your right knee and twist your torso to the right, looking behind you.",
      "Hold the stretch, then repeat on the other side."
    ],
    "pro_tip": "Use your elbow pressing against your knee as leverage. With every exhale, gently press a little harder to safely deepen the spinal twist."
  },
  {
    "muscle_group": "Core/Abs",
    "exercise_name": "Stretching - Spinal Stretch On Exercise Ball",
    "how_to_do": [
      "Sit on an exercise ball and slowly walk your feet forward.",
      "Lean back until your spine is completely draped over the contour of the ball.",
      "Relax your arms out to the sides toward the floor.",
      "Hold this extended position for 30-60 seconds."
    ],
    "pro_tip": "Focus entirely on deep, slow belly breathing. This expands the rib cage and deeply stretches the abdominal wall, which is essential after heavy core training."
  },
  {
    "muscle_group": "Core/Abs",
    "exercise_name": "Stretching - Standing Side Bend (bent arm)",
    "how_to_do": [
      "Stand tall and reach your right arm up and over your head, bending your elbow slightly.",
      "Lean your torso to the left, pushing your hips gently to the right.",
      "Feel the deep stretch along your right side and obliques.",
      "Hold for 30 seconds, then switch sides."
    ],
    "pro_tip": "Keep your chest facing completely forward. Do not let your upper body twist or cave toward the floor as you bend laterally."
  },
  {
    "muscle_group": "Core/Abs",
    "exercise_name": "Toe Touch Crunch",
    "how_to_do": [
      "Lie on your back and lift both legs straight up toward the ceiling.",
      "Reach your arms straight up toward your feet.",
      "Crunch your upper body off the floor, attempting to touch your toes with your fingers.",
      "Lower your shoulder blades back down and repeat."
    ],
    "pro_tip": "Keep your legs as stationary as a wall. The movement must come entirely from your upper abs contracting to lift your torso, not from kicking your legs down to meet your hands."
  },
  {
    "muscle_group": "Core/Abs",
    "exercise_name": "Twisting Crunch",
    "how_to_do": [
      "Lie on your back with your knees bent, feet flat, and hands lightly behind your head.",
      "Crunch upward and simultaneously twist your torso to bring your right shoulder toward your left knee.",
      "Lower back down to the floor smoothly.",
      "Alternate sides on every rep."
    ],
    "pro_tip": "Think about bringing your *shoulder* to your knee, not your elbow. This mental cue ensures proper rotation and maximum contraction of the oblique muscles."
  },
  {
    "muscle_group": "Core/Abs",
    "exercise_name": "V-Up",
    "how_to_do": [
      "Lie flat on your back with your arms extended straight overhead and your legs completely straight.",
      "Simultaneously lift your legs and your torso off the floor, reaching your hands toward your toes to form a 'V' shape.",
      "Hold the balance point for a split second.",
      "Lower your body back down with strict control without collapsing."
    ],
    "pro_tip": "Keep your arms and legs completely straight. If this is too difficult, bend your knees slightly to perform a 'tuck up' until your core strength improves."
  },
  {
    "muscle_group": "Core/Abs",
    "exercise_name": "Vertical Leg Raise (on parallel bars)",
    "how_to_do": [
      "Support yourself on parallel dip bars or a captain's chair, resting your forearms on the pads.",
      "Let your legs hang straight down toward the floor.",
      "Contract your lower abs to lift your legs straight out in front of you until they are parallel to the floor.",
      "Slowly lower them back to a dead hang."
    ],
    "pro_tip": "Do not let your shoulders shrug up toward your ears. Press down hard into the arm pads to keep your upper body locked and stable throughout the set."
  },
  {
    "muscle_group": "Core/Abs",
    "exercise_name": "Weighted Leg Extension Crunch",
    "how_to_do": [
      "Sit on the edge of a flat bench holding a light dumbbell securely between your feet.",
      "Lean your torso back while extending your legs straight out in front of you.",
      "Crunch your torso forward while simultaneously pulling your knees tightly into your chest.",
      "Slowly extend back out to the starting position."
    ],
    "pro_tip": "Grip the edges of the bench tightly with your hands for stability. The slower you extend your legs outward, the harder your lower abs are forced to work."
  },

  // ── Forearms ──────────────────────────────────────────────────────────────
  {
    "muscle_group": "Forearms",
    "exercise_name": "Barbell Reverse Wrist Curl (over-grip)",
    "how_to_do": [
      "Sit on a bench and rest your forearms flat on your thighs, allowing your wrists to hang off the edge of your knees.",
      "Hold a barbell with an overhand grip (palms facing the floor).",
      "Lower the bar by bending your wrists downward as far as comfortable.",
      "Curl the bar upward by extending your wrists as high as possible, keeping your forearms glued to your thighs."
    ],
    "pro_tip": "Keep your thumbs wrapped over the top of the bar alongside your fingers (a thumbless grip). This slight adjustment heavily increases isolation on the forearm extensors."
  },
  {
    "muscle_group": "Forearms",
    "exercise_name": "Barbell Standing Back Wrist Curl",
    "how_to_do": [
      "Stand tall holding a barbell behind your back with an overhand grip (palms facing away from your body).",
      "Let the barbell roll down slightly into your fingertips.",
      "Curl your fingers to roll the bar securely into your palms.",
      "Flex your wrists upward as high as possible, squeezing the forearms hard, then slowly lower."
    ],
    "pro_tip": "Keep your elbows completely locked out. If your elbows bend during the movement, you are shifting the workload to your biceps instead of your forearms."
  },
  {
    "muscle_group": "Forearms",
    "exercise_name": "Dumbbell Behind Back Wrist Curl",
    "how_to_do": [
      "Stand straight holding a dumbbell in each hand behind your glutes, with your palms facing away from you.",
      "Let the dumbbells roll down out of your palms and into your fingertips.",
      "Curl the dumbbells back up into your palms.",
      "Flex your wrists upward to peak the contraction, then return to the starting position."
    ],
    "pro_tip": "Using dumbbells instead of a barbell allows your wrists to move in a slightly more natural arc, making this a superior variation if you experience wrist pain with straight bars."
  },
  {
    "muscle_group": "Forearms",
    "exercise_name": "Dumbbell Over Bench Wrist Curl",
    "how_to_do": [
      "Kneel alongside a flat bench and lay your forearms across the pad.",
      "Hold a dumbbell in each hand with an underhand grip (palms facing the ceiling), letting your wrists hang off the edge.",
      "Let the dumbbells roll down into your fingertips.",
      "Curl the weight all the way up, squeezing the handles as tightly as you can at the top."
    ],
    "pro_tip": "Squeeze the dumbbell handles with maximum crushing force at the very top of every rep. This intense isometric contraction recruits every muscle fiber in your lower arms."
  },
  {
    "muscle_group": "Forearms",
    "exercise_name": "Dumbbell Seated Neutral Wrist Curl",
    "how_to_do": [
      "Sit on a bench holding a dumbbell in each hand with a neutral grip (palms facing each other).",
      "Rest your forearms on your thighs with your wrists hanging over your knees.",
      "Lower the dumbbells by tilting your wrists down toward the floor.",
      "Flex your wrists upward (like swinging a hammer) as far as they can go."
    ],
    "pro_tip": "This neutral grip perfectly targets the brachioradialis (the thick, meaty muscle on the top of the forearm). Use slow, strict reps and do not bounce the weight."
  },
  {
    "muscle_group": "Forearms",
    "exercise_name": "Stretching - Side Wrist Pull Stretch",
    "how_to_do": [
      "Extend your right arm straight out in front of you.",
      "Use your left hand to gently grasp the fingers of your right hand.",
      "Slowly pull your fingers to the side (outward or inward) to stretch the complex tendons of the wrist.",
      "Hold for 20-30 seconds, then switch hands."
    ],
    "pro_tip": "The wrist is a delicate joint consisting of many small bones. Apply pressure gently and continuously; never use jerky or forceful movements when stretching the wrists."
  },
  {
    "muscle_group": "Forearms",
    "exercise_name": "Stretching - Wrist Circles",
    "how_to_do": [
      "Extend your arms in front of you or rest your forearms on your lap.",
      "Clench your hands into light fists.",
      "Slowly rotate your wrists in a circular motion.",
      "Complete 10 large circles clockwise, then reverse and complete 10 circles counter-clockwise."
    ],
    "pro_tip": "Try to make the absolute largest circles possible without letting your forearms move. This maximizes joint lubrication and prepares the wrists for heavy pressing."
  },
  {
    "muscle_group": "Forearms",
    "exercise_name": "Weighted Standing Curl",
    "how_to_do": [
      "Stand tall holding a barbell or a pair of dumbbells with a pronated (overhand) grip.",
      "Pin your elbows tightly against your ribs.",
      "Curl the weight upward toward your shoulders, keeping your palms facing the floor.",
      "Lower the weight back down slowly under complete control."
    ],
    "pro_tip": "Keep your wrists perfectly straight and rigid throughout the entire curl. If your wrists bend backward under the weight, you will lose tension on the forearm muscles."
  },
  {
    "muscle_group": "Forearms",
    "exercise_name": "Wrist Curl",
    "how_to_do": [
      "Sit on a bench and rest your forearms flat against your thighs.",
      "Hold a barbell with an underhand grip (palms facing up), letting your wrists hang off your knees.",
      "Let the bar roll all the way down into the very tips of your fingers.",
      "Curl your fingers shut, then forcefully flex your wrists upward toward your face."
    ],
    "pro_tip": "Do not let your forearms lift off your thighs at any point. Keep them firmly planted like cement so that 100% of the movement is strictly isolated to the wrist joint."
  },

  // ── Glutes ────────────────────────────────────────────────────────────────
  {
    "muscle_group": "Glutes",
    "exercise_name": "Band Hip Abduction",
    "how_to_do": [
      "Loop a resistance band around both legs, resting it just above your knees or around your ankles.",
      "Stand tall, brace your core, and shift your weight slightly onto your non-working leg.",
      "Keeping your working leg straight, push it out to the side against the band's tension.",
      "Pause for a second at maximum tension, then slowly return to the starting position."
    ],
    "pro_tip": "Focus on leading the movement with your heel rather than your toes. Pointing your toes outward shifts the work to your hip flexors instead of the gluteus medius."
  },
  {
    "muscle_group": "Glutes",
    "exercise_name": "Band Hip Adduction",
    "how_to_do": [
      "Anchor a resistance band to a low point and loop the other end around the ankle of your working leg (the leg closest to the anchor).",
      "Stand tall and step away from the anchor to create tension.",
      "Keeping your leg straight, sweep it across the front of your body.",
      "Slowly resist the band as your leg returns to the starting position."
    ],
    "pro_tip": "Keep your hips perfectly square. If your torso twists or your hips rotate toward the anchor point, you lose the isolation on the adductor muscles."
  },
  {
    "muscle_group": "Glutes",
    "exercise_name": "Hip Abduction Machine",
    "how_to_do": [
      "Sit in the machine and place your outer thighs against the padded levers.",
      "Adjust the machine so your knees are close together in the starting position.",
      "Press your legs outward against the pads as wide as you comfortably can.",
      "Squeeze your glutes hard at the top, then slowly bring your knees back together."
    ],
    "pro_tip": "Try leaning your torso forward slightly while holding onto the machine. This shift in angle deeply stretches and activates the upper fibers of the glutes."
  },
  {
    "muscle_group": "Glutes",
    "exercise_name": "Hip Adduction Machine",
    "how_to_do": [
      "Sit in the machine and place your inner thighs against the padded levers.",
      "Set the machine to a wide starting angle where you feel a comfortable stretch.",
      "Squeeze your thighs together until the pads meet in the center.",
      "Control the weight as the pads slowly open back up."
    ],
    "pro_tip": "The adductor muscles respond incredibly well to isometric holds. Pause for one full second when the pads touch in the middle on every single rep."
  },
  {
    "muscle_group": "Glutes",
    "exercise_name": "Lever Seated Hip Abduction",
    "how_to_do": [
      "Sit back firmly against the backrest with the pads positioned on the outside of your knees.",
      "Grasp the handles to pull your hips down into the seat securely.",
      "Drive your knees outward to push the levers apart in a smooth motion.",
      "Resist the weight stack as you bring your knees back to the start."
    ],
    "pro_tip": "Never let the weight plates slam together at the bottom of the rep. Maintaining continuous tension ensures the outer glutes have zero time to rest."
  },
  {
    "muscle_group": "Glutes",
    "exercise_name": "Lever Seated Hip Adduction",
    "how_to_do": [
      "Sit in the plate-loaded or selectorized adductor machine with the pads inside your knees.",
      "Brace your core and pull your knees together to overcome the resistance.",
      "Hold the contraction tightly in the center.",
      "Slowly let your legs spread back to the starting width."
    ],
    "pro_tip": "Do not rush the eccentric (opening) phase. A strict 3-second negative phase here will dramatically increase inner thigh strength and prevent groin pulls."
  },
  {
    "muscle_group": "Glutes",
    "exercise_name": "Lever Standing Rear Kick",
    "how_to_do": [
      "Stand facing the machine, resting your torso on the support pad and grasping the handles.",
      "Place the sole of your working foot flat against the pushing plate.",
      "Drive your leg straight back and slightly upward by contracting your glute.",
      "Lower the plate under control without letting it rest at the bottom."
    ],
    "pro_tip": "Do not violently throw the weight back or hyper-extend your lower back. The movement must come purely from the hip joint to isolate the gluteus maximus."
  },
  {
    "muscle_group": "Glutes",
    "exercise_name": "Quadruped Hip Extension",
    "how_to_do": [
      "Get on your hands and knees (all fours) on a mat, with your wrists under your shoulders and knees under your hips.",
      "Keep your working knee bent at a 90-degree angle and your foot flexed.",
      "Drive the sole of your foot straight up toward the ceiling.",
      "Squeeze the glute at the top, then slowly lower your knee back to hover just above the floor."
    ],
    "pro_tip": "Brace your abs like you are about to be punched. If your lower back dips or arches as you kick upward, you are transferring the work away from the glutes."
  },
  {
    "muscle_group": "Glutes",
    "exercise_name": "Rear Decline Bridge",
    "how_to_do": [
      "Place your upper back and shoulders horizontally across a flat bench.",
      "Plant your feet flat on the floor, about hip-width apart.",
      "Drop your hips toward the floor while keeping your knees pushed out.",
      "Drive through your heels to thrust your hips upward until your body forms a straight line."
    ],
    "pro_tip": "Tuck your chin to your chest and look forward, rather than looking up at the ceiling. This keeps your spine neutral and forces the glutes to do the heavy lifting."
  },
  {
    "muscle_group": "Glutes",
    "exercise_name": "Single-Leg Hip Thrust",
    "how_to_do": [
      "Position your upper back across a bench with your hips hovering above the floor.",
      "Plant one foot firmly on the ground and raise the other leg into the air.",
      "Drive through the heel of your planted foot to thrust your hips up.",
      "Squeeze your glute hard at full extension, then lower your hips back down."
    ],
    "pro_tip": "Ensure your working shin is perfectly vertical at the top of the thrust. If your foot is too far forward, your hamstrings will take over; if it's too far back, you'll feel it in your quads."
  },
  {
    "muscle_group": "Glutes",
    "exercise_name": "Stretching - Adductor stretch",
    "how_to_do": [
      "Sit on the floor, bring the soles of your feet together in front of you, and let your knees fall out to the sides (Butterfly stretch).",
      "Grasp your ankles or feet and sit up completely straight.",
      "Gently press your knees toward the floor using your elbows, or actively use your muscles to pull them down.",
      "Hold the stretch for 30 to 60 seconds while breathing deeply."
    ],
    "pro_tip": "Keep your chest proud and hinge forward slightly from your hips rather than rounding your upper back. This safely deepens the stretch right at the groin."
  },
  {
    "muscle_group": "Glutes",
    "exercise_name": "Sumo Squat",
    "how_to_do": [
      "Take a very wide stance with your toes pointed outward at about a 45-degree angle.",
      "Hold a dumbbell vertically against your chest or a barbell across your back.",
      "Keeping your chest up, push your hips back and squat down deeply, ensuring your knees track perfectly over your toes.",
      "Drive through the floor to stand back up, squeezing your glutes tightly."
    ],
    "pro_tip": "Consciously try to 'spread the floor apart' with your feet as you stand up. This mental cue intensely fires up the side glutes and adductors during the press."
  },

  // ── Hamstrings ────────────────────────────────────────────────────────────
  {
    "muscle_group": "Hamstrings",
    "exercise_name": "Band Leg Curl",
    "how_to_do": [
      "Anchor a resistance band securely to a low point, like the leg of a heavy bench.",
      "Lie face down on the floor and loop the other end of the band around your ankles.",
      "Keeping your hips pressed firmly into the floor, curl your heels toward your glutes.",
      "Squeeze your hamstrings hard at the top, then slowly resist the band on the way down."
    ],
    "pro_tip": "Actively push your pelvis down into the floor as you curl. If your hips hike up, your lower back takes over the movement and your hamstrings lose tension."
  },
  {
    "muscle_group": "Hamstrings",
    "exercise_name": "Band Standing Leg Curl",
    "how_to_do": [
      "Loop a resistance band around a low anchor point and attach the other end to your working ankle.",
      "Stand tall facing the anchor, holding onto a wall or sturdy object for balance.",
      "Keeping your thighs aligned and your core tight, curl your heel up toward your glutes.",
      "Slowly lower your foot back to the starting position with control."
    ],
    "pro_tip": "Keep your knees glued together. If the knee of your working leg drifts forward, you involve your hip flexors and lose hamstring isolation."
  },
  {
    "muscle_group": "Hamstrings",
    "exercise_name": "Dumbbell Lying Femoral",
    "how_to_do": [
      "Lie face down on a flat bench with your knees hanging just off the edge.",
      "Have a partner place a dumbbell between your feet, or carefully secure it yourself by squeezing your feet together.",
      "Keeping your torso flat against the bench, curl the dumbbell up toward your glutes.",
      "Lower the weight back down slowly until your legs are nearly straight."
    ],
    "pro_tip": "Point your toes like a ballerina (plantar flexion) while performing the curl. This temporarily turns off your calf muscles, forcing the hamstrings to do 100% of the lifting."
  },
  {
    "muscle_group": "Hamstrings",
    "exercise_name": "Dumbbell Romanian Deadlift",
    "how_to_do": [
      "Stand with your feet hip-width apart, holding a dumbbell in each hand in front of your thighs.",
      "Keep your back completely straight and put a slight, fixed bend in your knees.",
      "Push your hips straight back as far as they will go, lowering the dumbbells down the front of your legs.",
      "Drive your hips forward and squeeze your glutes to return to a standing position."
    ],
    "pro_tip": "Think of this as a 'hip hinge' rather than a bend. Imagine there is a car door open behind you and you have to close it using only your butt."
  },
  {
    "muscle_group": "Hamstrings",
    "exercise_name": "Kettlebell Romanian Deadlift",
    "how_to_do": [
      "Hold a heavy kettlebell with both hands in front of your hips, standing with feet shoulder-width apart.",
      "Brace your core, keep your chest proud, and maintain a slight bend in your knees.",
      "Hinge at the hips, pushing them back until you feel a deep stretch in your hamstrings.",
      "Push through the floor with your heels to stand back up, locking out your hips at the top."
    ],
    "pro_tip": "Keep the kettlebell extremely close to your body, almost brushing your shins as it descends. Letting it swing away from you puts dangerous leverage on your lower back."
  },
  {
    "muscle_group": "Hamstrings",
    "exercise_name": "Lever Kneeling Leg Curl",
    "how_to_do": [
      "Position yourself in the kneeling leg curl machine, resting your forearms on the pads and one knee on the support.",
      "Hook the ankle of your working leg under the roller pad.",
      "Curl your heel smoothly upward toward your glutes, feeling the deep isolation.",
      "Lower the pad under strict control before repeating."
    ],
    "pro_tip": "Because this machine works one leg at a time, use it to fix strength imbalances. Always train your weaker hamstring first, and match the reps with your stronger side."
  },
  {
    "muscle_group": "Hamstrings",
    "exercise_name": "Lever Lying Leg Curl",
    "how_to_do": [
      "Lie face down on the leg curl machine, aligning your knees with the machine's pivot point.",
      "Adjust the roller pad so it rests on the back of your lower legs, just above your Achilles tendon.",
      "Grasp the handles to pull your body tight against the pad and curl your legs toward your glutes.",
      "Control the descent, stopping just before the weight stack touches."
    ],
    "pro_tip": "Pulling yourself hard into the bench using the handles prevents your hips from rising. A flat hip equals maximum hamstring recruitment."
  },
  {
    "muscle_group": "Hamstrings",
    "exercise_name": "Lever Seated Leg Curl",
    "how_to_do": [
      "Sit in the machine and adjust the backrest so your knees line up exactly with the pivot axis.",
      "Lower the thigh pad snugly against your legs to lock your lower body in place.",
      "Push the ankle pad down and back toward your glutes as far as possible.",
      "Slowly let the pad rise back up, keeping the hamstrings engaged."
    ],
    "pro_tip": "The seated leg curl puts the hamstrings in a highly stretched position at the start. Pause for one second at the top of every rep to maximize this stretch before curling."
  },
  {
    "muscle_group": "Hamstrings",
    "exercise_name": "Lying Leg Curl",
    "how_to_do": [
      "Lie prone on the machine with the pad resting just above your heels.",
      "Keep your torso flat and squeeze your glutes.",
      "Curl the weight up in a smooth, controlled arc until the pad gently taps your glutes.",
      "Lower the weight back down over a strict 3-second count."
    ],
    "pro_tip": "Flex your toes toward your shins (dorsiflexion) to bring the calf muscles into the movement, allowing you to lift slightly heavier weight and overload the hamstrings."
  },
  {
    "muscle_group": "Hamstrings",
    "exercise_name": "Seated Leg Curl",
    "how_to_do": [
      "Adjust the seat depth so the back of your knees rest comfortably against the edge of the seat.",
      "Secure the lap pad tightly over your thighs.",
      "Drive your heels down toward the floor and curl them back under the seat.",
      "Squeeze at the bottom, then return to the starting position."
    ],
    "pro_tip": "Grip the handles firmly and pull your torso forward slightly into the lap pad. This increases the stretch on the hamstrings and prevents lower back rounding."
  },
  {
    "muscle_group": "Hamstrings",
    "exercise_name": "Standing Leg Curl",
    "how_to_do": [
      "Stand in the single-leg curl machine, bracing your torso against the chest pad.",
      "Hook one ankle under the roller pad.",
      "Keeping your standing leg slightly bent for stability, curl the working leg backward and up.",
      "Slowly lower the leg back to the starting point."
    ],
    "pro_tip": "Brace your core tight as if you are about to be punched in the stomach. A rigid torso ensures you don't use momentum by throwing your upper body forward during the curl."
  },
  {
    "muscle_group": "Hamstrings",
    "exercise_name": "Stretching - Hamstring Stretch",
    "how_to_do": [
      "Sit on the floor with your legs extended straight out in front of you.",
      "Keep your chest up and reach your hands forward toward your toes.",
      "Stop when you feel a deep, comfortable stretch in the back of your thighs.",
      "Hold this position statically for 30 to 60 seconds while breathing deeply."
    ],
    "pro_tip": "Do not aggressively round your upper back to try and touch your toes. Hinge forward from the hips with a flat back to ensure the stretch actually targets the hamstrings."
  },

  // ── Quads ─────────────────────────────────────────────────────────────────
  {
    "muscle_group": "Quads",
    "exercise_name": "Band Bent Over Hip Extension",
    "how_to_do": [
      "Anchor a resistance band to a low point and loop the other end around one ankle.",
      "Face the anchor, step back to create tension, and bend over slightly at the hips, supporting yourself on a bench or wall.",
      "Keeping your working leg straight, drive your heel backward and upward against the band's resistance.",
      "Squeeze at the top, then slowly return your foot to the starting position."
    ],
    "pro_tip": "Keep your core braced and lower back completely flat. If your lower back arches, you are taking the load off your lower body and risking spinal pain."
  },
  {
    "muscle_group": "Quads",
    "exercise_name": "Band Seated Leg Extension",
    "how_to_do": [
      "Anchor a resistance band to the back leg of a chair or bench.",
      "Sit on the edge of the seat and loop the other end of the band around your ankle.",
      "Grip the sides of the seat for stability, keep your torso upright, and extend your leg straight out until your knee is locked.",
      "Slowly bend your knee to return to the starting position."
    ],
    "pro_tip": "Hold the fully extended position for 2 full seconds on every single rep. This maximizes the peak contraction in the teardrop muscle (VMO) above your knee."
  },
  {
    "muscle_group": "Quads",
    "exercise_name": "Band Standing Hip Extension",
    "how_to_do": [
      "Loop a resistance band around a low anchor and place it around your ankle.",
      "Stand facing the anchor, holding onto a wall or sturdy object for balance.",
      "Keeping your leg straight, push your leg straight back behind you until you feel a hard contraction.",
      "Control the tension as your leg returns to the starting position."
    ],
    "pro_tip": "Do not lean your torso forward as you push your leg back. Keep your chest up perfectly straight to force the lower body to do 100% of the work."
  },
  {
    "muscle_group": "Quads",
    "exercise_name": "Barbell Back Squat",
    "how_to_do": [
      "Step under the barbell and rest it across your upper back/traps (not your neck).",
      "Unrack the bar, step back, and set your feet about shoulder-width apart with your toes pointed slightly outward.",
      "Take a deep breath, brace your core, and push your hips back and down as if sitting in a chair.",
      "Drive hard through your mid-foot to stand back up, exhaling forcefully at the top."
    ],
    "pro_tip": "Pull the barbell down into your back as hard as you can during the movement. This engages your lats and creates a rigid upper back, preventing you from folding forward."
  },
  {
    "muscle_group": "Quads",
    "exercise_name": "Barbell Clean And Press",
    "how_to_do": [
      "Stand over a barbell with a shoulder-width stance, gripping the bar just outside your legs.",
      "Drop your hips, keep your chest up, and explosively pull the bar upward, extending your hips and knees.",
      "Drop quickly under the bar to catch it across your front shoulders (the clean) in a partial squat.",
      "Stand up out of the squat, then immediately press the barbell straight overhead to a lockout."
    ],
    "pro_tip": "Keep the bar as close to your body as possible during the pull. If the bar swings away from you, it will pull you off balance and kill your power."
  },
  {
    "muscle_group": "Quads",
    "exercise_name": "Barbell Front Chest Squat",
    "how_to_do": [
      "Rest the barbell across the front of your shoulders (anterior deltoids) and collarbone.",
      "Support the bar by crossing your arms over it or using a clean grip (fingertips under the bar, elbows pointing straight forward).",
      "Keep your chest up high, brace your core, and squat down until your thighs are parallel to the floor.",
      "Drive through your entire foot to return to a standing position."
    ],
    "pro_tip": "Pretend there is a laser pointer on your chest that must point straight ahead at all times. If it points at the floor, you will drop the bar."
  },
  {
    "muscle_group": "Quads",
    "exercise_name": "Barbell Lunge",
    "how_to_do": [
      "Place a barbell across your upper back, just like a back squat.",
      "Take a large step forward with your right foot and plant it securely.",
      "Lower your hips until both knees are bent at a 90-degree angle (your back knee should hover just above the floor).",
      "Push forcefully off your front foot to step back to the starting position, then alternate legs."
    ],
    "pro_tip": "To target the quads more heavily, take a slightly shorter step and keep your torso completely upright. For more glute focus, take a wider step and lean slightly forward."
  },
  {
    "muscle_group": "Quads",
    "exercise_name": "Classic Barbell Squat",
    "how_to_do": [
      "Position a barbell on a squat rack at upper-chest height.",
      "Step under the bar, resting it securely on your traps, and stand up to unrack it.",
      "Take one step back, plant your feet shoulder-width apart, and squat down by breaking at the hips and knees simultaneously.",
      "Drive the weight back up to the starting position."
    ],
    "pro_tip": "Push your knees out actively as you descend and ascend. If your knees cave inward (valgus collapse), you lose power and put dangerous stress on the knee joints."
  },
  {
    "muscle_group": "Quads",
    "exercise_name": "Close Feet Leg Press",
    "how_to_do": [
      "Sit in a leg press machine and place your feet flat on the sled, directly next to each other (touching or a few inches apart).",
      "Unlatch the safety handles and slowly lower the sled toward your chest.",
      "Stop when your knees reach a 90-degree angle or slightly deeper.",
      "Press the sled back up using your quads, stopping just short of locking your knees."
    ],
    "pro_tip": "A close stance shifts the massive majority of the load directly onto the vastus lateralis (the outer quad sweep). Focus on pushing through the outer edge of your feet."
  },
  {
    "muscle_group": "Quads",
    "exercise_name": "Dumbbell Bar Grip Sumo Squat",
    "how_to_do": [
      "Hold a single heavy dumbbell vertically by grasping the top weight plate with both hands.",
      "Take a very wide stance with your toes pointed outward at a 45-degree angle.",
      "Keep your chest up and squat down until the dumbbell nearly touches the floor.",
      "Push the floor away through your heels to stand back up, squeezing your glutes and quads."
    ],
    "pro_tip": "The sumo stance heavily engages the adductors (inner thighs). Ensure your knees track perfectly in line with your outward-pointing toes."
  },
  {
    "muscle_group": "Quads",
    "exercise_name": "Dumbbell Front Squat",
    "how_to_do": [
      "Hold a pair of dumbbells up at your shoulders, letting one head of each dumbbell rest lightly on your front deltoids.",
      "Set your feet shoulder-width apart, brace your core, and squat down smoothly.",
      "Keep your torso as vertical as possible to maintain the weight over your mid-foot.",
      "Drive back up to a standing position."
    ],
    "pro_tip": "Keep your elbows pointed forward and up. If your elbows drop, the dumbbells will pull you forward and you will lose your balance."
  },
  {
    "muscle_group": "Quads",
    "exercise_name": "Dumbbell Goblet Squat",
    "how_to_do": [
      "Hold a single dumbbell vertically against your chest, cupping the top end with both hands like a heavy goblet.",
      "Set your feet slightly wider than shoulder-width.",
      "Squat down, aiming to drop your elbows directly between your knees at the bottom of the movement.",
      "Push through the floor to return to the top."
    ],
    "pro_tip": "The goblet squat is the ultimate tool for fixing squat depth. Use the weight as a counterbalance to sit back deeply while keeping your spine perfectly straight."
  },
  {
    "muscle_group": "Quads",
    "exercise_name": "Dumbbell Lunge",
    "how_to_do": [
      "Stand tall holding a dumbbell in each hand down by your sides.",
      "Step forward with one leg and bend both knees to lower your hips toward the floor.",
      "Stop when your trailing knee is an inch above the ground.",
      "Drive through the heel of your front foot to push yourself back to the starting position."
    ],
    "pro_tip": "Keep your front shin perfectly vertical as you lunge down. This protects the knee joint while ensuring maximum tension on the working quad."
  },
  {
    "muscle_group": "Quads",
    "exercise_name": "Dumbbell Single Leg Squat",
    "how_to_do": [
      "Stand a few feet in front of a bench, holding dumbbells by your sides.",
      "Reach one foot backward and rest the top of your foot securely on the bench (Bulgarian Split Squat setup).",
      "Lower your body until your front thigh is parallel to the floor.",
      "Push hard through your front foot to extend your leg back to the top."
    ],
    "pro_tip": "If you struggle with balance, drop one dumbbell and use your free hand to hold onto a rack or wall. Stability equals the ability to push harder."
  },
  {
    "muscle_group": "Quads",
    "exercise_name": "Dumbbell Squat",
    "how_to_do": [
      "Stand holding a dumbbell in each hand, letting them hang down by your sides.",
      "Keep your chest up and push your hips back to initiate the squat.",
      "Lower yourself until your thighs are parallel to the floor.",
      "Press through your feet to stand back up."
    ],
    "pro_tip": "Look straight ahead or slightly upward. Looking down at the floor will cause your upper back to round, shifting the weight dangerously."
  },
  {
    "muscle_group": "Quads",
    "exercise_name": "Front Squat",
    "how_to_do": [
      "Rack a barbell across your front shoulders and clavicles, supporting it with your fingertips or crossed arms.",
      "Step back and plant your feet shoulder-width apart.",
      "Keeping your torso extremely upright, bend your knees and squat down deeply.",
      "Drive out of the hole aggressively to return to standing."
    ],
    "pro_tip": "The front squat places massive emphasis on the quads and upper back. If the bar is choking you slightly, it is in the correct position on your neck/shoulders."
  },
  {
    "muscle_group": "Quads",
    "exercise_name": "Goblet Squat",
    "how_to_do": [
      "Hold a dumbbell or kettlebell tight to your chest.",
      "Brace your core, push your knees outward, and sit down into a deep squat.",
      "Pause for one second at the bottom.",
      "Drive upward forcefully, squeezing your glutes at the top."
    ],
    "pro_tip": "Think about 'tearing the floor apart' with your feet as you stand up. This engages your glutes and stabilizes your knees during the press."
  },
  {
    "muscle_group": "Quads",
    "exercise_name": "Hack Squat",
    "how_to_do": [
      "Step into the hack squat machine, placing your shoulders under the pads and your back flat against the backrest.",
      "Place your feet on the platform roughly shoulder-width apart.",
      "Disengage the safety handles and lower the sled by bending your knees until they hit 90 degrees.",
      "Push through the platform to extend your legs back to the start."
    ],
    "pro_tip": "Place your feet slightly lower on the platform to bias the quads, or higher on the platform to bias the glutes and hamstrings."
  },
  {
    "muscle_group": "Quads",
    "exercise_name": "Leg Extension",
    "how_to_do": [
      "Sit in the leg extension machine and align your knee joint exactly with the machine's pivot point.",
      "Adjust the ankle pad so it rests comfortably on your lower shin, just above your foot.",
      "Hold the side handles firmly to pull your butt down into the seat, and extend your legs fully straight.",
      "Lower the weight under complete control."
    ],
    "pro_tip": "Do not kick or swing the weight up. Imagine pushing the pad away using only a strict, isolated squeeze of your quadriceps."
  },
  {
    "muscle_group": "Quads",
    "exercise_name": "Leg Press",
    "how_to_do": [
      "Sit securely in the leg press machine and place your feet squarely on the sled.",
      "Release the safety catches and slowly lower the weight toward you.",
      "Bring your knees as close to your chest as possible without your lower back rounding off the pad.",
      "Drive the sled back up smoothly."
    ],
    "pro_tip": "NEVER lock your knees out violently at the top of the movement. Stop just a fraction of an inch before full lockout to protect the joint and keep tension on the muscle."
  },
  {
    "muscle_group": "Quads",
    "exercise_name": "Lever Horizontal Leg Press",
    "how_to_do": [
      "Sit in the horizontal leg press machine with your back flat against the pad.",
      "Place your feet on the pressing plate.",
      "Push the plate away from you until your legs are fully extended.",
      "Slowly bend your knees to bring the plate back to the starting position."
    ],
    "pro_tip": "Because you are seated horizontally, this variation takes stress off the lower back. Focus on a slow 3-second negative (descent) on every single rep."
  },
  {
    "muscle_group": "Quads",
    "exercise_name": "Lever Leg Extension",
    "how_to_do": [
      "Sit in the plate-loaded or selectorized leg extension machine.",
      "Secure the shin pad and grip the handles tightly.",
      "Drive your shins upward until your legs are completely locked out and parallel to the floor.",
      "Lower the weight smoothly without letting the plates crash at the bottom."
    ],
    "pro_tip": "Point your toes slightly outward (duck stance) during the extension to heavily target the vastus medialis (inner teardrop), or straight ahead for overall quad development."
  },
  {
    "muscle_group": "Quads",
    "exercise_name": "Lever Standing Hip Extension",
    "how_to_do": [
      "Step into the standing hip extension machine and hook your ankle behind the roller pad.",
      "Hold the handles and keep your torso perfectly upright.",
      "Push your leg backward against the pad as far as comfortable.",
      "Slowly let the leg return to the start."
    ],
    "pro_tip": "Keep the movement strictly in the hip joint. If your lower back is arching aggressively, the weight is too heavy."
  },
  {
    "muscle_group": "Quads",
    "exercise_name": "Lunge",
    "how_to_do": [
      "Stand tall with your feet together, holding dumbbells or just your bodyweight.",
      "Step forward confidently with one leg, landing on your heel first, then flat foot.",
      "Drop your back knee straight down until it hovers over the floor.",
      "Push off the front foot to return to the starting position."
    ],
    "pro_tip": "Think of lunges like walking on train tracks, not a tightrope. Keep your feet hip-width apart even when stepping forward to maintain perfect balance."
  },
  {
    "muscle_group": "Quads",
    "exercise_name": "Single-Leg Squat to Bench",
    "how_to_do": [
      "Stand on one leg facing away from a flat bench or box.",
      "Extend your non-working leg out in front of you.",
      "Keeping your chest up, slowly sit back onto the bench using only your standing leg.",
      "Tap your glutes to the bench gently, then drive back up to a standing position."
    ],
    "pro_tip": "Do not rock backward or use momentum when you hit the bench. It should be a soft, controlled tap to build immense unilateral quad strength."
  },
  {
    "muscle_group": "Quads",
    "exercise_name": "Sissy Squat",
    "how_to_do": [
      "Stand next to a sturdy object to hold onto for balance.",
      "Rise up onto your toes and lean your torso straight backward, creating a straight line from your knees to your head.",
      "Bend your knees to lower your body forward and down, keeping your hips fully extended.",
      "Push through your toes and flex your quads to pull yourself back to the top."
    ],
    "pro_tip": "This is an extremely advanced bodyweight isolation exercise. Only go down as far as you can comfortably control without knee pain."
  },
  {
    "muscle_group": "Quads",
    "exercise_name": "Sled 45 Degree Leg Wide Press",
    "how_to_do": [
      "Sit in the 45-degree leg press and place your feet wide and high on the platform, toes pointed out.",
      "Lower the sled smoothly, tracking your knees outward in the same direction as your toes.",
      "Stop when your knees reach a 90-degree angle.",
      "Press through your heels to push the sled back to the starting position."
    ],
    "pro_tip": "The wide, high stance heavily targets the glutes, hamstrings, and adductors while still engaging the quads. Ensure your knees do not cave in during the push."
  },
  {
    "muscle_group": "Quads",
    "exercise_name": "Sled Hack Squat",
    "how_to_do": [
      "Step into the sled hack squat, securing your shoulders under the pads.",
      "Place your feet on the platform, unlock the safety, and lower yourself down.",
      "Keep your lower back flat against the pad as you descend deep into the squat.",
      "Drive the weight back up forcefully."
    ],
    "pro_tip": "Because your back is supported, you can safely train to complete muscular failure. Use this machine at the end of your workout to absolutely torch the quads."
  },
  {
    "muscle_group": "Quads",
    "exercise_name": "Smith Chair Squat",
    "how_to_do": [
      "Set the Smith machine bar to shoulder height and place it across your upper back.",
      "Walk your feet forward about 18-24 inches so you are leaning your body back into the bar.",
      "Squat straight down, as if sliding down a wall into an invisible chair.",
      "Push through your heels to slide back up to a standing position."
    ],
    "pro_tip": "Positioning your feet far forward completely removes the hips from the movement, turning this into a brutal, pure quad-isolation squat."
  },
  {
    "muscle_group": "Quads",
    "exercise_name": "Smith Leg Press",
    "how_to_do": [
      "Lie on your back on the floor directly under the Smith machine bar.",
      "Place your feet flat on the underside of the bar, hip-width apart.",
      "Unlock the bar and slowly lower it toward your chest by bending your knees.",
      "Press the bar back up straight toward the ceiling."
    ],
    "pro_tip": "Use a spotter or ensure the safety catches are perfectly set. This old-school vertical leg press is highly effective but requires strict safety precautions."
  },
  {
    "muscle_group": "Quads",
    "exercise_name": "Smith Machine Squat",
    "how_to_do": [
      "Step under the Smith machine bar and rest it securely on your traps.",
      "Stand with your feet slightly in front of the bar path, shoulder-width apart.",
      "Squat down until your thighs break parallel to the floor.",
      "Drive back up smoothly using the guided track of the machine."
    ],
    "pro_tip": "Because the bar path is fixed, experiment with your foot placement until the movement feels completely natural and pain-free on your lower back and knees."
  },
  {
    "muscle_group": "Quads",
    "exercise_name": "Squat",
    "how_to_do": [
      "Stand with your feet shoulder-width apart, toes pointed slightly out.",
      "Keep your chest up and push your hips back as you bend your knees.",
      "Lower your body as deeply as you can while maintaining a flat lower back.",
      "Press through your full foot to return to standing."
    ],
    "pro_tip": "Pause at the very bottom of the squat for 3 seconds before standing up. This removes the stretch reflex and builds incredible raw starting strength."
  },
  {
    "muscle_group": "Quads",
    "exercise_name": "Step Up",
    "how_to_do": [
      "Stand facing a sturdy box or bench holding dumbbells by your sides.",
      "Place your right foot firmly on the center of the box.",
      "Drive through your right heel to step up, bringing your left foot onto the box.",
      "Step down slowly with control, leading with the left foot, and repeat."
    ],
    "pro_tip": "Do not bounce off the floor with your bottom leg. All the upward force must be generated strictly by the leg resting on the box."
  },
  {
    "muscle_group": "Quads",
    "exercise_name": "Stretching - All Fours Squad Stretch",
    "how_to_do": [
      "Get on your hands and knees on a soft mat.",
      "Reach back with one hand and grab the top of the foot on the same side.",
      "Gently pull your heel toward your glutes while keeping your core braced.",
      "Hold the stretch for 30 seconds, then switch sides."
    ],
    "pro_tip": "Slightly tilt your pelvis forward (tuck your tailbone) as you pull the foot. This deepens the stretch across the entire front of the thigh."
  },
  {
    "muscle_group": "Quads",
    "exercise_name": "Stretching - Boat Stretch",
    "how_to_do": [
      "Sit on the floor, lean back slightly, and balance on your sit bones.",
      "Bend your knees and reach forward to grab your ankles or the tops of your feet.",
      "Gently pull your heels toward your glutes.",
      "Hold the position to stretch the quads and hip flexors."
    ],
    "pro_tip": "Focus on deep, controlled breathing to help the muscles relax into the stretch."
  },
  {
    "muscle_group": "Quads",
    "exercise_name": "Stretching - Ceiling Look Stretch",
    "how_to_do": [
      "Lie face down on a mat.",
      "Place your hands flat on the floor near your shoulders and press your upper body up while leaving your hips on the floor (similar to a yoga cobra pose).",
      "Look up toward the ceiling to extend the stretch through your core and hip flexors.",
      "Hold for 20-30 seconds."
    ],
    "pro_tip": "If this pinches your lower back, rest on your forearms instead of your hands to reduce the spinal extension."
  },
  {
    "muscle_group": "Quads",
    "exercise_name": "Stretching - Crossover Kneeling Hip Flexor Stretch",
    "how_to_do": [
      "Get into a kneeling lunge position with your right knee on the floor and left foot forward.",
      "Slightly shift your right foot out to the side.",
      "Lean forward into the lunge, feeling the stretch in the front of your right hip.",
      "Hold the stretch securely, then switch legs."
    ],
    "pro_tip": "Squeeze the glute of the kneeling leg. This principle of reciprocal inhibition instantly forces the hip flexor on the front to relax and stretch further."
  },
  {
    "muscle_group": "Quads",
    "exercise_name": "Stretching - Hip Circles Stretch",
    "how_to_do": [
      "Stand with your feet shoulder-width apart and place your hands on your hips.",
      "Slowly rotate your hips in a wide circle, pushing them forward, to the side, back, and around.",
      "Complete 10 large circles in one direction.",
      "Reverse the motion and complete 10 circles in the opposite direction."
    ],
    "pro_tip": "This is an active mobility drill. Keep your head relatively still in space and make the movement entirely about the hips to lubricate the joint."
  },
  {
    "muscle_group": "Quads",
    "exercise_name": "Stretching - Hip Extension Stretch",
    "how_to_do": [
      "Lie on your back on a high bench with your glutes near the edge.",
      "Pull one knee tight into your chest.",
      "Let the other leg hang straight down off the edge of the bench toward the floor.",
      "Let gravity pull the hanging leg down for 30 seconds."
    ],
    "pro_tip": "This is the Thomas Stretch. Completely relax the hanging leg; do not try to actively push it down. Let gravity do the work to open up tight hip flexors."
  },
  {
    "muscle_group": "Quads",
    "exercise_name": "Stretching - Hip Flexor and Quad Stretch",
    "how_to_do": [
      "Get into a deep lunge position with your back knee resting on a soft mat.",
      "Reach back with your hand on the same side and grab the top of your back foot.",
      "Gently pull the heel toward your glutes while slightly pushing your hips forward.",
      "Hold for 30-45 seconds, breathing deeply."
    ],
    "pro_tip": "Place a pad or rolled-up towel under your kneeling knee to ensure comfort so you can focus entirely on the stretch."
  },
  {
    "muscle_group": "Quads",
    "exercise_name": "Stretching - Hip Flexor Stretch Rear foot elevated",
    "how_to_do": [
      "Place your back foot up on a bench or couch, and step your front foot forward into a lunge position (Couch Stretch).",
      "Drop your back knee to the floor close to the bench.",
      "Slowly raise your torso up until it is completely vertical.",
      "Hold this intense stretch in the front of your thigh and hip for 45 seconds."
    ],
    "pro_tip": "This is widely considered the best quad/hip stretch in existence. If it's too intense, lean your torso forward and place your hands on the floor to reduce the stretch."
  },
  {
    "muscle_group": "Quads",
    "exercise_name": "Stretching - Knee Raise",
    "how_to_do": [
      "Stand tall, maintaining good posture.",
      "Lift one knee straight up toward your chest as high as comfortable.",
      "Use both hands to hug the knee lightly and pull it closer.",
      "Release, return to standing, and switch legs."
    ],
    "pro_tip": "This acts as a dynamic stretch for the glutes and a mobility drill for the hip flexors. Do 10 alternating reps per leg before squatting."
  },
  {
    "muscle_group": "Quads",
    "exercise_name": "Stretching - Quadriceps lying stretch",
    "how_to_do": [
      "Lie on your side on a mat, keeping your body in a straight line.",
      "Bend your top knee and reach back with your top hand to grab your ankle.",
      "Gently pull your heel toward your glutes, keeping your knees close together.",
      "Hold for 30 seconds and roll over to stretch the other leg."
    ],
    "pro_tip": "Do not let your stretched knee drift upward toward the ceiling. Keep it parallel with your resting leg to ensure the stretch hits the quad belly."
  },
  {
    "muscle_group": "Quads",
    "exercise_name": "Stretching - Quadriceps stretch",
    "how_to_do": [
      "Stand tall and hold onto a wall or sturdy object for balance.",
      "Bend one knee, bringing your heel up behind you, and grab your foot with your hand.",
      "Gently pull the foot toward your glutes.",
      "Keep your knees together and your torso upright. Hold for 30 seconds."
    ],
    "pro_tip": "Stand tall and push your hips slightly forward during the hold. This dramatically increases the stretch across the upper quad."
  },
  {
    "muscle_group": "Quads",
    "exercise_name": "Stretching - Runners Stretch",
    "how_to_do": [
      "Get into a push-up position, then step your right foot all the way up outside your right hand.",
      "Drop your hips low to the ground, keeping your back leg straight.",
      "Hold the deep lunge position, feeling the stretch in the hips and groin.",
      "Hold for 30 seconds, step back, and switch sides."
    ],
    "pro_tip": "To deepen the stretch, try to lower your forearms to the floor inside your front foot (Lizard Pose)."
  },
  {
    "muscle_group": "Quads",
    "exercise_name": "Weighted Sissy Squat",
    "how_to_do": [
      "Hold a weight plate or dumbbell tightly to your chest.",
      "Rise up onto your toes and lean your torso back, keeping your hips and back perfectly aligned.",
      "Lower yourself down by bending your knees forward toward the floor.",
      "Flex your quads hard to pull yourself back to the starting upright position."
    ],
    "pro_tip": "Only add weight if you can comfortably perform 15 strict, unweighted sissy squats. The tension on the patellar tendon is extreme, so proceed with strict form."
  },

  // ── Shoulders ─────────────────────────────────────────────────────────────
  {
    "muscle_group": "Shoulders",
    "exercise_name": "Arnold Press",
    "how_to_do": [
      "Sit on a bench with back support, holding two dumbbells in front of your face with your palms facing toward you.",
      "Brace your core and begin pressing the dumbbells overhead.",
      "As you press, rotate your wrists outward so your palms face forward at the top of the movement.",
      "Reverse the motion smoothly, lowering the weight and rotating your palms back to face you."
    ],
    "pro_tip": "Do not rush the rotation. The twist should happen smoothly throughout the entire press to maximize engagement of the front and side delts."
  },
  {
    "muscle_group": "Shoulders",
    "exercise_name": "Band Bent-over Rear Lateral Raise",
    "how_to_do": [
      "Stand on the center of a resistance band and grab the opposite ends so the band crosses to form an 'X'.",
      "Hinge at your hips until your torso is nearly parallel to the floor, keeping a flat back.",
      "With a slight bend in your elbows, pull the band handles up and out to your sides.",
      "Squeeze your rear delts at the top, then slowly lower your arms back down."
    ],
    "pro_tip": "Keep your neck neutral by looking at the floor slightly ahead of you. Shrugging your shoulders will transfer the load to your traps instead of your rear delts."
  },
  {
    "muscle_group": "Shoulders",
    "exercise_name": "Band One Arm Forward Raise",
    "how_to_do": [
      "Step on one end of a resistance band and hold the other end in one hand, resting it against your thigh.",
      "Keep your arm straight with a micro-bend in the elbow.",
      "Raise your arm straight out in front of you until it is parallel with the floor.",
      "Control the band's tension as you slowly lower it back to your thigh."
    ],
    "pro_tip": "Avoid leaning back as you raise the band. Keep your core braced and torso completely vertical."
  },
  {
    "muscle_group": "Shoulders",
    "exercise_name": "Band Standing Rear Delt Row",
    "how_to_do": [
      "Anchor a resistance band securely at chest height and hold an end in each hand.",
      "Step back until there is tension on the band, keeping your arms straight out in front of you.",
      "Pull your elbows back and wide, keeping them flared out at shoulder level.",
      "Squeeze your upper back and rear delts, then slowly extend your arms forward."
    ],
    "pro_tip": "Focus on driving your elbows straight back. If you pull your hands toward your stomach, your lats will take over the movement."
  },
  {
    "muscle_group": "Shoulders",
    "exercise_name": "Barbell Front Raise",
    "how_to_do": [
      "Stand tall holding a barbell with an overhand, shoulder-width grip resting against your thighs.",
      "Keeping your arms straight with a slight bend in the elbows, raise the barbell directly in front of you.",
      "Pause when your arms are parallel to the floor.",
      "Slowly lower the barbell back to the starting position."
    ],
    "pro_tip": "Do not use momentum to swing the weight up. If you have to lean back to lift the bar, it is too heavy."
  },
  {
    "muscle_group": "Shoulders",
    "exercise_name": "Barbell Seated Behind Head Military Press",
    "how_to_do": [
      "Sit on a bench with a barbell resting across your upper back/traps, using a grip slightly wider than shoulder-width.",
      "Brace your core and press the barbell straight up over your head until your arms are fully extended.",
      "Slowly lower the barbell back down behind your head.",
      "Stop when the bar reaches ear level to protect your shoulder capsules."
    ],
    "pro_tip": "This exercise requires excellent shoulder mobility. If you feel any pinching or pain in your shoulder joints, switch to standard front military presses immediately."
  },
  {
    "muscle_group": "Shoulders",
    "exercise_name": "Barbell Upright Row",
    "how_to_do": [
      "Stand holding a barbell with an overhand grip, hands about shoulder-width apart.",
      "Keep the bar close to your body and pull it straight up toward your chin.",
      "Lead with your elbows, ensuring they stay higher than your forearms.",
      "Pause at the top, then slowly lower the bar back to the starting position."
    ],
    "pro_tip": "Stop pulling when your elbows reach shoulder height. Pulling higher than your shoulders can cause shoulder impingement over time."
  },
  {
    "muscle_group": "Shoulders",
    "exercise_name": "Barbell Upright Row (wide-grip)",
    "how_to_do": [
      "Stand holding a barbell with an overhand grip, hands significantly wider than shoulder-width.",
      "Pull the bar upward, keeping it close to your torso.",
      "Focus on driving your elbows up and outward to the sides.",
      "Lower the bar back to your thighs in a controlled motion."
    ],
    "pro_tip": "The wide grip shifts the primary focus from the traps directly onto the lateral (side) deltoids. Focus entirely on the elbows moving outward."
  },
  {
    "muscle_group": "Shoulders",
    "exercise_name": "Cable Crossover Reverse Fly",
    "how_to_do": [
      "Stand between two high cable pulleys. Grab the left handle with your right hand and the right handle with your left hand.",
      "Step back slightly so your arms form a crossover shape in front of you.",
      "Keep a slight bend in your elbows and pull your arms down and out to your sides.",
      "Squeeze your rear delts at the bottom, then slowly return to the crossed starting position."
    ],
    "pro_tip": "Do not pinch your shoulder blades completely together. Stop the movement when your arms are in line with your body to keep all tension on the rear delts rather than the rhomboids."
  },
  {
    "muscle_group": "Shoulders",
    "exercise_name": "Cable Front Raise",
    "how_to_do": [
      "Attach a straight bar or D-handle to a low cable pulley and stand facing away from the machine.",
      "Pass the cable between your legs and grab the handle with an overhand grip.",
      "Keep your arm straight and raise the handle forward until it reaches eye level.",
      "Lower the handle slowly, resisting the cable's pull on the way down."
    ],
    "pro_tip": "Using a cable provides continuous tension throughout the whole range of motion. Focus intensely on the negative (downward) phase of the lift."
  },
  {
    "muscle_group": "Shoulders",
    "exercise_name": "Cable Lateral Raise",
    "how_to_do": [
      "Stand sideways to a low cable pulley and grab the D-handle with your outside hand.",
      "Keep a slight bend in your elbow and brace your core.",
      "Raise your arm out to the side until it is parallel to the floor.",
      "Slowly lower the handle back down, stopping just before the weight stack touches."
    ],
    "pro_tip": "Run the cable behind your back instead of in front of you to get a slightly deeper stretch on the lateral delt at the bottom of the movement."
  },
  {
    "muscle_group": "Shoulders",
    "exercise_name": "Cable One Arm Forward Raise",
    "how_to_do": [
      "Attach a D-handle to a low pulley and stand facing away from the machine.",
      "Grip the handle with one hand and let it rest next to your thigh.",
      "Keeping your arm straight, raise it directly in front of you to shoulder height.",
      "Slowly control the descent back to your thigh."
    ],
    "pro_tip": "Place your non-working hand on your core or the machine for stability. Preventing your torso from twisting is key to isolating the front delt."
  },
  {
    "muscle_group": "Shoulders",
    "exercise_name": "Cable One Arm Lateral Raise",
    "how_to_do": [
      "Set a cable pulley to the lowest setting and stand next to it, gripping the machine frame with your inside hand for support.",
      "Grab the handle with your outside hand and lean slightly away from the machine.",
      "Raise your arm directly out to the side until it reaches shoulder height.",
      "Resist the weight as you lower your arm back to the starting position."
    ],
    "pro_tip": "Leaning away from the machine increases the range of motion and places maximum tension on the lateral delt at the very top of the arc."
  },
  {
    "muscle_group": "Shoulders",
    "exercise_name": "Cable Rear Delt Fly",
    "how_to_do": [
      "Set two cable pulleys to head-height. Cross your arms to grab the left handle with your right hand and the right handle with your left.",
      "Stand tall with your arms extended in front of you.",
      "Pull your arms horizontally out to your sides until they are in line with your shoulders.",
      "Return the handles to the starting position in a slow, controlled manner."
    ],
    "pro_tip": "Pretend you are pushing the walls away from you. This mental cue stops you from pulling with your back and isolates the rear delts perfectly."
  },
  {
    "muscle_group": "Shoulders",
    "exercise_name": "Cable Rear Delt Row (with rope)",
    "how_to_do": [
      "Attach a rope to a cable pulley set at upper-chest height.",
      "Grab the rope with both hands and take a few steps back to create tension.",
      "Keep your elbows high and pull the rope directly toward your face/upper chest.",
      "Spread the rope apart at the end of the movement, squeezing your rear delts."
    ],
    "pro_tip": "Flare your elbows out to 90 degrees. If you tuck your elbows down, you will engage your lats instead of your rear deltoids."
  },
  {
    "muscle_group": "Shoulders",
    "exercise_name": "Clean and Press",
    "how_to_do": [
      "Stand with feet shoulder-width apart, holding a barbell on the floor with an overhand grip.",
      "Explosively extend your hips and knees to pull the bar up, dropping underneath to 'catch' it at shoulder level (the clean).",
      "Stabilize yourself, then press the barbell straight overhead until your arms lock out.",
      "Carefully lower the bar back to your shoulders, then to the floor."
    ],
    "pro_tip": "This is a full-body power movement. Drive the barbell overhead using the momentum generated from a slight dip in your knees, not just shoulder strength."
  },
  {
    "muscle_group": "Shoulders",
    "exercise_name": "Dumbbell Alternate Shoulder Press",
    "how_to_do": [
      "Sit on a bench with back support, holding two dumbbells at shoulder height with palms facing forward.",
      "Press your right arm overhead until fully extended, while holding the left dumbbell steady at your shoulder.",
      "Lower the right dumbbell back down to the starting position.",
      "Repeat the pressing motion with your left arm."
    ],
    "pro_tip": "Keep your core incredibly tight. The asymmetrical load will try to twist your spine, so stabilizing your torso is crucial for safety and power."
  },
  {
    "muscle_group": "Shoulders",
    "exercise_name": "Dumbbell Arnold Press",
    "how_to_do": [
      "Hold two dumbbells in front of your chest with your palms facing toward your face.",
      "Begin pressing the weights overhead.",
      "As the dumbbells pass your forehead, rotate your wrists outward so your palms face forward at full lockout.",
      "Reverse the exact path on the way down, finishing with palms facing you."
    ],
    "pro_tip": "Keep your elbows slightly elevated at the bottom of the movement. Letting them rest on your chest completely removes the tension from the deltoids."
  },
  {
    "muscle_group": "Shoulders",
    "exercise_name": "Dumbbell Bench Seated Press",
    "how_to_do": [
      "Sit securely on an upright bench, holding a dumbbell in each hand resting on your thighs.",
      "Kick the dumbbells up to shoulder height, with your palms facing forward.",
      "Press the weight straight up until the dumbbells nearly touch overhead.",
      "Slowly lower them back to ear level."
    ],
    "pro_tip": "Do not arch your lower back excessively. Press your back flat against the pad to protect your lumbar spine and strictly isolate the shoulders."
  },
  {
    "muscle_group": "Shoulders",
    "exercise_name": "Dumbbell Front Raise",
    "how_to_do": [
      "Stand holding a dumbbell in each hand resting on the front of your thighs.",
      "Keeping a slight bend in your elbows, raise both dumbbells directly in front of you.",
      "Pause when your arms are parallel to the floor.",
      "Lower the weights slowly back to your thighs."
    ],
    "pro_tip": "Turn your thumbs slightly upward as you raise the dumbbells. This slight rotation maximizes front delt engagement and is safer for the shoulder joint."
  },
  {
    "muscle_group": "Shoulders",
    "exercise_name": "Dumbbell Incline Hammer Press",
    "how_to_do": [
      "Set an adjustable bench to a steep incline (around 60-75 degrees).",
      "Hold dumbbells at shoulder height with a neutral grip (palms facing each other).",
      "Press the dumbbells straight up overhead.",
      "Lower them back down slowly, keeping your elbows tucked forward slightly."
    ],
    "pro_tip": "The neutral grip is incredibly shoulder-friendly. Use this variation if standard barbell or dumbbell presses cause you shoulder pain."
  },
  {
    "muscle_group": "Shoulders",
    "exercise_name": "Dumbbell Incline Rear Lateral Raise",
    "how_to_do": [
      "Set a bench to a low incline and lie face down with your chest on the pad.",
      "Hold a light dumbbell in each hand, letting your arms hang straight down toward the floor.",
      "With a slight bend in your elbows, raise the dumbbells out to the sides in a wide arc.",
      "Squeeze your rear delts at the top, then slowly lower the weights."
    ],
    "pro_tip": "Using the bench eliminates all momentum. Think about leading the raise with your pinky fingers to fully activate the rear deltoids."
  },
  {
    "muscle_group": "Shoulders",
    "exercise_name": "Dumbbell Iron Cross",
    "how_to_do": [
      "Stand holding dumbbells at your sides.",
      "Raise both arms straight out to your sides until they are parallel to the floor, forming a 'T' or cross shape with your body.",
      "Hold this extended position isometrically for the target time.",
      "Slowly lower the weights back to your sides."
    ],
    "pro_tip": "Do not lock your elbows completely straight. A micro-bend prevents elbow strain while keeping the intense tension entirely on the lateral deltoids."
  },
  {
    "muscle_group": "Shoulders",
    "exercise_name": "Dumbbell Lateral Raise",
    "how_to_do": [
      "Stand tall holding a dumbbell in each hand by your sides.",
      "Keep your chest up and a slight bend in your elbows.",
      "Raise the dumbbells straight out to your sides until your arms are parallel to the floor.",
      "Lower the weight under control back to the starting position."
    ],
    "pro_tip": "Think about pushing the dumbbells *away* toward the walls, rather than just lifting them up. This cue ensures the lateral delt does all the work, not the traps."
  },
  {
    "muscle_group": "Shoulders",
    "exercise_name": "Dumbbell One Arm Lateral Raise",
    "how_to_do": [
      "Hold a dumbbell in one hand and hold onto a solid structure (like a rack or bench) with your free hand.",
      "Lean slightly away from the anchor point.",
      "Raise the dumbbell directly out to the side to shoulder height.",
      "Slowly lower it back down."
    ],
    "pro_tip": "Performing lateral raises one arm at a time allows you to focus 100% of your neural drive into one muscle, and the slight lean provides a superior stretch at the bottom."
  },
  {
    "muscle_group": "Shoulders",
    "exercise_name": "Dumbbell Rear Delt Row",
    "how_to_do": [
      "Hinge at the hips until your torso is almost parallel to the floor, holding dumbbells hanging straight down.",
      "Flare your elbows out wide to the sides.",
      "Row the dumbbells upward by driving your elbows straight up toward the ceiling.",
      "Squeeze the back of your shoulders, then lower the weights."
    ],
    "pro_tip": "Pulling with your elbows flared completely out to a 90-degree angle ensures the rear deltoid is targeted over the lats and mid-back."
  },
  {
    "muscle_group": "Shoulders",
    "exercise_name": "Dumbbell Rear Lateral Raise",
    "how_to_do": [
      "Bend over at the hips, keeping your back completely flat and holding a dumbbell in each hand.",
      "Let the weights hang down in front of you with a slight bend in your elbows.",
      "Raise your arms out to the sides until they are in line with your shoulders.",
      "Lower the dumbbells slowly back to the start."
    ],
    "pro_tip": "Keep your head down and neck neutral. Looking up strains your cervical spine and causes you to rely on momentum rather than muscle contraction."
  },
  {
    "muscle_group": "Shoulders",
    "exercise_name": "Dumbbell Seated Front Raise",
    "how_to_do": [
      "Sit on a bench with a back support, holding dumbbells down by your sides.",
      "Keeping your core braced against the pad, raise both dumbbells directly in front of you.",
      "Pause when your arms are parallel to the floor.",
      "Control the descent back to your sides."
    ],
    "pro_tip": "Being seated prevents you from using your legs or hips to swing the weight up. This strict form will likely require you to use lighter weights than standing raises."
  },
  {
    "muscle_group": "Shoulders",
    "exercise_name": "Dumbbell Seated Lateral Raise",
    "how_to_do": [
      "Sit securely on a flat bench holding dumbbells straight down at your sides.",
      "With a slight bend in your elbows, raise the weights laterally out to the sides.",
      "Stop when your elbows reach shoulder height.",
      "Slowly lower the dumbbells back down without letting them rest at the bottom."
    ],
    "pro_tip": "Pour the water: As you reach the top of the movement, slightly tilt the dumbbells forward as if you were pouring water from a pitcher. This optimally activates the side delt."
  },
  {
    "muscle_group": "Shoulders",
    "exercise_name": "Dumbbell Shoulder Press",
    "how_to_do": [
      "Stand holding dumbbells at shoulder level with your palms facing forward.",
      "Press the weights overhead until your arms are fully extended.",
      "Keep your core tight to avoid excessive arching in your lower back.",
      "Slowly lower the dumbbells back to your shoulders."
    ],
    "pro_tip": "Do not let the dumbbells touch at the top of the movement. Stopping an inch apart keeps constant tension on the deltoids."
  },
  {
    "muscle_group": "Shoulders",
    "exercise_name": "Dumbbell Upright Row",
    "how_to_do": [
      "Stand holding two dumbbells in front of your thighs with an overhand grip.",
      "Pull the dumbbells straight up the front of your body toward your chin.",
      "Ensure your elbows flare out and travel higher than your wrists.",
      "Lower the weights slowly back to the starting position."
    ],
    "pro_tip": "Using dumbbells instead of a straight barbell allows your wrists and shoulders to move more freely, which significantly reduces the risk of shoulder impingement."
  },
  {
    "muscle_group": "Shoulders",
    "exercise_name": "EZ Barbell Anti Gravity Press",
    "how_to_do": [
      "Lie on an incline bench set to a high angle (around 75 degrees).",
      "Grip an EZ bar and hold it straight out in front of your body, parallel to the floor.",
      "Press the bar upward in an arc toward the ceiling, keeping your arms relatively straight.",
      "Slowly lower the bar back down to the parallel starting position."
    ],
    "pro_tip": "This is a unique movement designed to isolate the front deltoids. Keep the weight extremely light and focus purely on the burn at the top of the arc."
  },
  {
    "muscle_group": "Shoulders",
    "exercise_name": "Lever Lateral Raise",
    "how_to_do": [
      "Sit in the lateral raise machine and adjust the seat so the pivot point aligns with your shoulders.",
      "Place your forearms against the pads and grasp the handles.",
      "Push your elbows up and out to the sides until they are parallel with the floor.",
      "Lower the pads with a controlled tempo."
    ],
    "pro_tip": "Lead with your elbows, not your hands. Driving upward with your elbows perfectly targets the lateral deltoid head."
  },
  {
    "muscle_group": "Shoulders",
    "exercise_name": "Lever Military Press",
    "how_to_do": [
      "Adjust the seat of the shoulder press machine so the handles are roughly at shoulder level.",
      "Grip the handles firmly, brace your core, and press the weight straight upward.",
      "Extend your arms fully without locking out your elbows violently.",
      "Slowly let the handles return to the starting position."
    ],
    "pro_tip": "Keep your back firmly pressed against the pad throughout the entire set. Arching away from the pad shifts the work to your upper chest instead of your shoulders."
  },
  {
    "muscle_group": "Shoulders",
    "exercise_name": "Lever Seated Reverse Fly",
    "how_to_do": [
      "Sit facing the pad of a pec-deck/rear-delt machine.",
      "Grasp the horizontal handles with your arms slightly bent in front of you.",
      "Pull the handles backward in a wide arc until your hands are parallel with your body.",
      "Control the weight as it returns to the front."
    ],
    "pro_tip": "Keep your chest glued to the pad. If your chest comes off the pad, you are using momentum and spinal extension rather than your rear delts."
  },
  {
    "muscle_group": "Shoulders",
    "exercise_name": "Military Press",
    "how_to_do": [
      "Stand with your feet together or shoulder-width apart, holding a barbell at upper chest height.",
      "Brace your core, squeeze your glutes, and press the bar strictly overhead.",
      "Once the bar clears your head, slightly push your head forward to lock out directly over your center of gravity.",
      "Lower the bar under control back to your upper chest."
    ],
    "pro_tip": "Squeezing your glutes and bracing your abs tightly prevents your spine from hyper-extending, making the lift much safer and stronger."
  },
  {
    "muscle_group": "Shoulders",
    "exercise_name": "Prone Rear Delt Raise",
    "how_to_do": [
      "Lie face down on a flat or slightly inclined bench holding light dumbbells.",
      "Let your arms hang straight down toward the floor.",
      "Raise your arms straight out to the sides, focusing on the contraction in the back of your shoulders.",
      "Slowly lower the dumbbells back to the starting position."
    ],
    "pro_tip": "Try turning your thumbs slightly downward (internal rotation) as you raise the dumbbells. This can heavily increase the isolation on the rear delt."
  },
  {
    "muscle_group": "Shoulders",
    "exercise_name": "Resistance Band Lateral Raise",
    "how_to_do": [
      "Stand securely on the middle of a resistance band.",
      "Hold the ends of the band down by your sides with a slight bend in your elbows.",
      "Raise your arms straight out to the sides until they reach shoulder level.",
      "Resist the tension as you slowly lower your arms back down."
    ],
    "pro_tip": "Resistance bands are hardest at the top of the movement. Hold the top contracted position for 2 full seconds on every rep to build incredible stability."
  },
  {
    "muscle_group": "Shoulders",
    "exercise_name": "Seated Dumbbell Press",
    "how_to_do": [
      "Sit on an upright bench with back support, holding dumbbells at ear level.",
      "Press the dumbbells straight overhead until your arms are fully extended.",
      "Pause for a moment at the top without clicking the dumbbells together.",
      "Lower the weights slowly, stopping when your elbows hit 90 degrees or slightly below."
    ],
    "pro_tip": "Tuck your elbows forward slightly at a 45-degree angle rather than perfectly flared out. This is a much stronger pressing position and keeps your shoulder joints healthy."
  },
  {
    "muscle_group": "Shoulders",
    "exercise_name": "Seated Rear Delt Fly",
    "how_to_do": [
      "Sit on the edge of a bench and lean forward until your chest is resting on your knees.",
      "Hold a dumbbell in each hand underneath your legs.",
      "Raise your arms out to the sides in a wide arc until they are parallel to the floor.",
      "Slowly lower the weights back under your legs."
    ],
    "pro_tip": "Focus heavily on the 'sweep' outward. If you bend your elbows too much, the movement turns into a row and hits your back rather than your rear delts."
  },
  {
    "muscle_group": "Shoulders",
    "exercise_name": "Smith Machine Shoulder Press",
    "how_to_do": [
      "Place an upright bench under the Smith machine bar and adjust it so the bar lowers in front of your face.",
      "Sit down and grip the bar slightly wider than shoulder-width.",
      "Unrack the bar and press it straight overhead.",
      "Lower it slowly back to chin/upper chest level."
    ],
    "pro_tip": "Because the Smith machine bar is on a fixed vertical track, make sure your bench is positioned perfectly so the bar path feels completely natural on your joints."
  },
  {
    "muscle_group": "Shoulders",
    "exercise_name": "Smith Seated Shoulder Press",
    "how_to_do": [
      "Set up an upright bench inside the Smith machine.",
      "Grab the bar with a pronated grip and unhook it from the safety latches.",
      "Lower the bar down to your upper chest in a smooth, controlled motion.",
      "Drive the bar back up to full lockout."
    ],
    "pro_tip": "The Smith machine allows you to focus purely on pressing power without worrying about stabilization. Use this to safely push closer to failure than you would with free weights."
  },
  {
    "muscle_group": "Shoulders",
    "exercise_name": "Stretching - Band Warm-up Shoulder Stretch",
    "how_to_do": [
      "Grip a light resistance band (or a PVC pipe) with your hands wider than shoulder-width.",
      "Keeping your arms completely straight, slowly raise the band overhead and behind your back.",
      "Bring the band all the way down to your lower back.",
      "Reverse the motion to bring the band back in front of you."
    ],
    "pro_tip": "These are called 'shoulder dislocates.' Keep tension on the band throughout. If you cannot keep your arms perfectly straight, widen your grip."
  },
  {
    "muscle_group": "Shoulders",
    "exercise_name": "Stretching - Rear Deltoid Stretch",
    "how_to_do": [
      "Stand tall and bring your right arm horizontally across the front of your chest.",
      "Use your left hand or forearm to gently press your right arm closer to your chest.",
      "You should feel a deep stretch in the back of your right shoulder.",
      "Hold for 30 seconds, then switch arms."
    ],
    "pro_tip": "Do not pull directly on the elbow joint. Apply the pressure just above or below the elbow to protect the joint while stretching."
  },
  {
    "muscle_group": "Shoulders",
    "exercise_name": "Stretching - Seated Shoulder Flexor Depresor Retractor",
    "how_to_do": [
      "Sit on the floor with your knees bent and feet flat.",
      "Place your hands on the floor directly behind you, fingers pointing away from your body.",
      "Slowly scoot your hips forward away from your hands while keeping your arms straight.",
      "Stop when you feel a strong stretch in the front of your shoulders and chest, holding for 30 seconds."
    ],
    "pro_tip": "Keep your chest puffed out proudly. Letting your shoulders slump forward ruins the stretch and places strain on the shoulder capsule."
  },

  // ── Triceps ───────────────────────────────────────────────────────────────
  {
    "muscle_group": "Triceps",
    "exercise_name": "Band Overhead Triceps Extension",
    "how_to_do": [
      "Step on one end of the resistance band and grasp the other end behind your neck.",
      "Stand tall, brace your core, and point your elbows straight up toward the ceiling.",
      "Extend your arms fully overhead by contracting your triceps.",
      "Slowly lower the band back to the starting position behind your neck."
    ],
    "pro_tip": "Keep your elbows locked directly next to your ears. Letting them drift outward shifts the tension off the long head of your triceps."
  },
  {
    "muscle_group": "Triceps",
    "exercise_name": "Band Side Triceps Pushdown",
    "how_to_do": [
      "Anchor a resistance band to a high point and stand sideways to it.",
      "Grasp the band with the arm furthest from the anchor point, keeping your elbow pinned to your side.",
      "Push the band straight down across your body until your arm is fully extended.",
      "Control the band as it returns to the starting position."
    ],
    "pro_tip": "Focus on keeping your shoulder completely still. The only joint that should move is your elbow."
  },
  {
    "muscle_group": "Triceps",
    "exercise_name": "Band Triceps Pushdown",
    "how_to_do": [
      "Anchor a resistance band securely above head height.",
      "Grasp the band with both hands, keeping your elbows tucked tightly against your ribs.",
      "Push your hands down toward the floor until your arms are fully locked out.",
      "Slowly resist the tension as you return to a 90-degree angle."
    ],
    "pro_tip": "At the bottom of the movement, slightly pull the band apart to get an intense peak contraction in the lateral head of the triceps."
  },
  {
    "muscle_group": "Triceps",
    "exercise_name": "Barbell Close Grip Bench Press",
    "how_to_do": [
      "Lie flat on a bench and grip the barbell slightly narrower than shoulder-width.",
      "Unrack the weight and slowly lower the bar to your lower chest/upper stomach area.",
      "Keep your elbows tucked tightly to your sides throughout the descent.",
      "Press the bar explosively back to the starting position, squeezing your triceps."
    ],
    "pro_tip": "Do not grip the bar too close (hands touching). A shoulder-width or slightly narrower grip protects your wrists while still isolating the triceps."
  },
  {
    "muscle_group": "Triceps",
    "exercise_name": "Bench Dip",
    "how_to_do": [
      "Sit on the edge of a flat bench and place your hands just outside your hips, fingers facing forward.",
      "Walk your feet out so your hips slide off the bench, supporting your weight with your arms.",
      "Lower your body by bending your elbows until they reach a 90-degree angle.",
      "Push through the palms of your hands to extend your arms and raise your body back up."
    ],
    "pro_tip": "Keep your back as close to the bench as possible. Drifting forward places dangerous stress on your shoulder capsules."
  },
  {
    "muscle_group": "Triceps",
    "exercise_name": "Bench Dips",
    "how_to_do": [
      "Position your hands on a bench directly next to your hips and extend your legs out straight in front of you.",
      "Lower your torso by bending your elbows until you feel a stretch in your triceps and chest.",
      "Drive hard through your palms to lift your body back to the starting lockout position.",
      "Squeeze your triceps forcefully at the top of the movement."
    ],
    "pro_tip": "To make this instantly harder, elevate your feet on a second bench or place a weight plate across your lap."
  },
  {
    "muscle_group": "Triceps",
    "exercise_name": "Cable Lying Triceps Extension",
    "how_to_do": [
      "Place a flat bench in front of a low cable pulley equipped with a straight bar or EZ bar attachment.",
      "Lie on your back with your head near the pulley and grab the bar overhead.",
      "Keep your upper arms stationary and pointing slightly backward, then extend your elbows to pull the bar toward the ceiling.",
      "Slowly lower the bar back down behind your head."
    ],
    "pro_tip": "Position your upper arms at a slight angle toward your head rather than perfectly vertical to maintain constant tension on the triceps at the top of the rep."
  },
  {
    "muscle_group": "Triceps",
    "exercise_name": "Cable Overhead Extension",
    "how_to_do": [
      "Attach a straight bar or rope to a high cable pulley and face away from the machine.",
      "Grab the attachment behind your head, stagger your stance for balance, and lean forward slightly.",
      "Keeping your elbows fixed near your head, extend your arms forward until fully straight.",
      "Control the weight as it returns behind your head."
    ],
    "pro_tip": "Squeeze your glutes and brace your core. This prevents your lower back from arching and ensures all the force is generated by your triceps."
  },
  {
    "muscle_group": "Triceps",
    "exercise_name": "Cable Overhead Triceps Extension (rope attachment)",
    "how_to_do": [
      "Set a cable pulley to a low or mid level and attach a rope.",
      "Grab the rope, turn your back to the machine, and raise your hands behind your head.",
      "Extend your elbows to press the rope straight overhead and slightly forward.",
      "Spread the rope apart at the top, then slowly lower it back behind your neck."
    ],
    "pro_tip": "Spreading the rope apart at the very top of the extension forces peak contraction in the long head of the triceps. Don't skip that last inch of the movement."
  },
  {
    "muscle_group": "Triceps",
    "exercise_name": "Cable Pushdown (rope attachment)",
    "how_to_do": [
      "Attach a rope to a high cable pulley and grab both ends.",
      "Pin your elbows securely against your torso and hinge slightly forward at the hips.",
      "Push the rope down, spreading the ends apart as you reach the bottom.",
      "Pause for a second at full lockout, then return to the top smoothly."
    ],
    "pro_tip": "Imagine your elbows are glued to your ribs. If your elbows swing forward on the way up, your lats will take over the weight."
  },
  {
    "muscle_group": "Triceps",
    "exercise_name": "Cable Rope High Pulley Overhead Triceps Extension",
    "how_to_do": [
      "Attach a rope to the highest pulley setting on the cable machine.",
      "Face away from the machine, grasp the rope, and lean your torso forward at a 45-degree angle.",
      "Press the rope forward and out, locking your elbows at the end of the movement.",
      "Let the rope slowly travel back behind your head, feeling the deep stretch in your triceps."
    ],
    "pro_tip": "Use a staggered foot stance (one foot forward, one foot back). This gives you a solid base to push heavy weight without losing your balance."
  },
  {
    "muscle_group": "Triceps",
    "exercise_name": "Cable Standing One Arm Triceps Extension",
    "how_to_do": [
      "Attach a single D-handle to a high pulley.",
      "Stand sideways or facing the machine, gripping the handle with one hand.",
      "Keep your elbow tucked to your side and push the handle straight down until your arm is fully extended.",
      "Slowly resist the weight as your arm returns to a 90-degree angle."
    ],
    "pro_tip": "Place your non-working hand lightly on the triceps of your working arm. This mind-muscle connection cue helps ensure you feel the exact muscle firing."
  },
  {
    "muscle_group": "Triceps",
    "exercise_name": "Cable Triceps Pushdown",
    "how_to_do": [
      "Attach a straight or V-bar to a high pulley.",
      "Take an overhand grip, keep your chest up, and lock your elbows at your sides.",
      "Push the bar down until your arms are entirely straight.",
      "Control the weight on the way up, stopping when your forearms are just above parallel to the floor."
    ],
    "pro_tip": "Keep your wrists perfectly straight and stiff. Bending your wrists backward at the bottom puts stress on the joint and reduces force output."
  },
  {
    "muscle_group": "Triceps",
    "exercise_name": "Close Grip Push-ups",
    "how_to_do": [
      "Assume a push-up position but place your hands narrower than shoulder-width, directly under your chest.",
      "Keep your body in a straight, rigid line from head to heels.",
      "Lower yourself, keeping your elbows tucked tightly against your ribs.",
      "Push forcefully back up to the starting position."
    ],
    "pro_tip": "Create a diamond shape with your thumbs and index fingers for maximum triceps activation, but widen the grip slightly if you experience any wrist discomfort."
  },
  {
    "muscle_group": "Triceps",
    "exercise_name": "Dumbbell Close Grip Press",
    "how_to_do": [
      "Lie on a flat bench holding two dumbbells directly over your chest with a neutral grip (palms facing each other).",
      "Keep the dumbbells pressed together as you slowly lower them to the center of your chest.",
      "Keep your elbows tucked tightly against your sides.",
      "Press the dumbbells back up, maintaining the squeeze between them."
    ],
    "pro_tip": "Actively squeeze the dumbbells into each other throughout the entire range of motion to dramatically increase time under tension."
  },
  {
    "muscle_group": "Triceps",
    "exercise_name": "Dumbbell Incline Triceps Extension",
    "how_to_do": [
      "Set a bench to a 45-degree incline and lie back, holding dumbbells straight over your shoulders.",
      "Keeping your upper arms stationary, bend your elbows to lower the dumbbells down beside your ears.",
      "Pause when you feel a deep stretch in your triceps.",
      "Extend your elbows to press the dumbbells back to the top position."
    ],
    "pro_tip": "The incline bench puts the long head of the triceps in a massive stretch. Focus purely on a slow, controlled negative (descent) for maximum growth."
  },
  {
    "muscle_group": "Triceps",
    "exercise_name": "Dumbbell Kickback",
    "how_to_do": [
      "Place one knee and one hand on a flat bench, keeping your back straight and parallel to the floor.",
      "Hold a dumbbell in your free hand, row it up so your upper arm is parallel to the ground.",
      "Keeping your upper arm completely locked in place, extend your elbow until your arm is straight back.",
      "Squeeze for a full second, then slowly lower the dumbbell back to a 90-degree angle."
    ],
    "pro_tip": "Do not swing the weight! Momentum ruins this exercise. Use a lighter weight and focus entirely on the squeeze at the top."
  },
  {
    "muscle_group": "Triceps",
    "exercise_name": "Dumbbell Lying Alternate Extension",
    "how_to_do": [
      "Lie on a flat bench holding two dumbbells straight up over your chest, palms facing each other.",
      "Keeping your left arm locked straight, bend your right elbow to lower the dumbbell beside your right ear.",
      "Press the right dumbbell back to the top.",
      "Repeat the movement with your left arm while holding the right arm steady."
    ],
    "pro_tip": "Alternating arms forces your core to engage to stabilize your body on the bench, and it ensures you are dedicating 100% focus to one triceps at a time."
  },
  {
    "muscle_group": "Triceps",
    "exercise_name": "Dumbbell Lying Triceps Extension",
    "how_to_do": [
      "Lie on a bench holding two dumbbells directly above your head, palms facing each other.",
      "Keep your upper arms perfectly still and lower the dumbbells down beside your head by bending your elbows.",
      "Stop when the dumbbells are near your ears.",
      "Flex your triceps to drive the dumbbells back to the starting position."
    ],
    "pro_tip": "Point your elbows slightly inward toward each other. This prevents shoulder strain and isolates the triceps more effectively."
  },
  {
    "muscle_group": "Triceps",
    "exercise_name": "Dumbbell One Arm Triceps Extension",
    "how_to_do": [
      "Sit on a bench with back support or stand tall, holding one dumbbell straight up overhead.",
      "Support your working arm by placing your free hand on your elbow or bicep.",
      "Lower the dumbbell behind your head in a slow, controlled arc.",
      "Extend your arm straight back up to the ceiling."
    ],
    "pro_tip": "Avoid dropping your chin to your chest. Keep your head up and neck neutral to allow the dumbbell a full range of motion behind your head."
  },
  {
    "muscle_group": "Triceps",
    "exercise_name": "Dumbbell Pronate-grip Triceps Extension",
    "how_to_do": [
      "Lie on a flat bench holding dumbbells above your chest with a pronated (palms facing away from you) grip.",
      "Keep your upper arms stationary and bend your elbows to lower the weights toward your forehead or ears.",
      "Push the dumbbells back up to the starting position, keeping the palms-forward grip.",
      "Lock out hard at the top of the movement."
    ],
    "pro_tip": "The pronated grip shifts the focus heavily onto the lateral (outer) head of the triceps. Use a slightly lighter weight to maintain control."
  },
  {
    "muscle_group": "Triceps",
    "exercise_name": "Dumbbell Seated Kickback",
    "how_to_do": [
      "Sit on the very edge of a bench and lean your torso forward until it is nearly parallel to the floor.",
      "Hold a dumbbell in each hand, row your elbows up high, and pin them to your sides.",
      "Simultaneously extend both arms backward until they are fully locked out.",
      "Hold the contraction for a moment, then return to the starting position."
    ],
    "pro_tip": "Keep your neck in a neutral position by staring at the floor a few feet in front of you. Do not crank your neck upward to look in the mirror."
  },
  {
    "muscle_group": "Triceps",
    "exercise_name": "Dumbbell Seated Triceps Extension",
    "how_to_do": [
      "Sit on a bench with vertical back support, holding a single heavy dumbbell with both hands securely under the inner plate.",
      "Press the dumbbell overhead so your arms are fully extended.",
      "Lower the weight behind your head by bending your elbows, keeping your biceps close to your ears.",
      "Press the weight back up to full extension."
    ],
    "pro_tip": "Brace your core tight against the backrest. Arching your lower back takes the focus off the triceps and risks spinal injury."
  },
  {
    "muscle_group": "Triceps",
    "exercise_name": "EZ Barbell Lying Triceps Extension",
    "how_to_do": [
      "Lie on a flat bench and grip the EZ bar on the inner angled grips.",
      "Press the bar straight up over your chest.",
      "Keeping your upper arms stationary, lower the bar in an arc toward your forehead (Skullcrusher) or slightly behind your head.",
      "Contract your triceps to extend your arms back to the top."
    ],
    "pro_tip": "Lowering the bar slightly *behind* your head instead of directly to your forehead keeps constant tension on the triceps at lockout and is safer for your elbows."
  },
  {
    "muscle_group": "Triceps",
    "exercise_name": "Lever Seated Dips",
    "how_to_do": [
      "Sit in the seated dip machine and adjust the handles so your elbows are at a 90-degree angle.",
      "Grip the handles firmly, brace your core, and push down until your arms are fully extended.",
      "Pause briefly at the bottom to squeeze the triceps.",
      "Slowly let the handles rise back up to the starting position, maintaining tension."
    ],
    "pro_tip": "Keep your chest up and shoulders pinned down and back. If your shoulders shrug upward, you are transferring the load from your triceps to your traps."
  },
  {
    "muscle_group": "Triceps",
    "exercise_name": "Lever Triceps Extension",
    "how_to_do": [
      "Adjust the seat of the triceps extension machine so your elbows align exactly with the machine's pivot point.",
      "Rest your upper arms on the pad and grip the handles.",
      "Push down and forward in a smooth arc to fully extend your arms.",
      "Control the weight as it comes back up, stopping before the weight stack touches down."
    ],
    "pro_tip": "Press your back firmly against the pad to prevent your body from swaying and using momentum. The movement must be entirely isolated to the elbows."
  },
  {
    "muscle_group": "Triceps",
    "exercise_name": "Lever Triceps Extension (neutral grip)",
    "how_to_do": [
      "Set yourself up in the triceps extension machine, utilizing the vertical (neutral) handles so your palms face each other.",
      "Plant your elbows firmly on the padding.",
      "Drive the handles down and forward until your arms lock out.",
      "Release the weight slowly, focusing on the deep stretch in your triceps."
    ],
    "pro_tip": "The neutral grip is extremely joint-friendly. If you suffer from elbow tendonitis (tennis elbow), use this grip variation to train pain-free."
  },
  {
    "muscle_group": "Triceps",
    "exercise_name": "Lying Cable Tricep Extension",
    "how_to_do": [
      "Position a flat bench under a high cable pulley equipped with a straight bar.",
      "Lie flat on the bench, reach back, and grab the bar with an overhand grip.",
      "With your upper arms pointing toward the ceiling, extend your elbows to push the bar forward and down.",
      "Control the bar back up until it reaches a 90-degree bend."
    ],
    "pro_tip": "Using a cable provides constant, smooth tension throughout the entire range of motion, unlike a barbell where tension drops off at the top."
  },
  {
    "muscle_group": "Triceps",
    "exercise_name": "Lying Tricep Extension",
    "how_to_do": [
      "Lie on a flat bench holding dumbbells or a barbell straight above you.",
      "Keep your shoulders completely locked and lower the weight toward your forehead.",
      "Stop just before the weight touches you.",
      "Drive the weight back up to a full lockout."
    ],
    "pro_tip": "Pretend your elbows are bolted to an invisible wall in space. They should not drift forward or backward during the rep."
  },
  {
    "muscle_group": "Triceps",
    "exercise_name": "Old School Reverse Extensions",
    "how_to_do": [
      "Lie on your back on the floor or a bench holding a barbell with a reverse grip (palms facing your face).",
      "Keep your arms straight up, then slowly bend your elbows to lower the bar toward the top of your head.",
      "Maintain the reverse grip as you push the bar back up to the starting position.",
      "Lock your elbows and squeeze hard at the top."
    ],
    "pro_tip": "The reverse grip highly isolates the medial head of the triceps. Grip the bar tightly to maintain wrist stability."
  },
  {
    "muscle_group": "Triceps",
    "exercise_name": "Overhead Cable Rope Extension",
    "how_to_do": [
      "Attach a rope to a low pulley and grab it with both hands.",
      "Turn away from the machine and lift the rope behind your head, staggering your feet.",
      "Keep your elbows pointed up and push the rope straight toward the ceiling.",
      "Separate the rope handles at the top, then slowly lower back down."
    ],
    "pro_tip": "Keep your core tight to stop the heavy cable from pulling you backward. A strong staggered stance is essential here."
  },
  {
    "muscle_group": "Triceps",
    "exercise_name": "Overhead Tricep Extension",
    "how_to_do": [
      "Stand tall or sit securely, holding one heavy dumbbell overhead with both hands securely gripping the inner plate.",
      "Keep your elbows tucked near your ears.",
      "Slowly lower the dumbbell behind your head until your forearms break a 90-degree angle.",
      "Power the weight back up to the starting position."
    ],
    "pro_tip": "Inhale deeply as you lower the weight to expand your ribcage, and exhale sharply as you press the weight to maintain intra-abdominal pressure."
  },
  {
    "muscle_group": "Triceps",
    "exercise_name": "Resistance Band Pushdown",
    "how_to_do": [
      "Loop a resistance band over a pull-up bar or high anchor.",
      "Grab the band with both hands, keeping your elbows pinned to your ribs.",
      "Press downward until your arms are fully straight and the band is taut.",
      "Slowly release the tension to return to the starting point."
    ],
    "pro_tip": "Because resistance bands get heavier the further you stretch them, the contraction at the bottom is intense. Hold that lockout for 2 seconds on every rep."
  },
  {
    "muscle_group": "Triceps",
    "exercise_name": "Stretching - Kneeling Triceps Extension",
    "how_to_do": [
      "Kneel in front of a flat bench or box.",
      "Place your elbows on the edge of the bench and hold your hands together behind your neck.",
      "Drop your chest toward the floor to deepen the stretch in your triceps and lats.",
      "Hold the stretch for 30 to 60 seconds while breathing deeply."
    ],
    "pro_tip": "Hold a light dumbbell or a PVC pipe in your hands to anchor them behind your head, which intensifies the stretch on the long head of the triceps."
  },
  {
    "muscle_group": "Triceps",
    "exercise_name": "Stretching - Reverse Dip",
    "how_to_do": [
      "Sit on the floor with your hands planted behind you, fingers pointing away from your body.",
      "Gently slide your hips forward away from your hands while keeping your arms straight.",
      "Stop when you feel a strong stretch in your shoulders, chest, and triceps.",
      "Hold the position for 30 seconds."
    ],
    "pro_tip": "Do not force this stretch aggressively. Ease into it slowly, as it requires a high degree of shoulder mobility."
  },

  // ── Back ──────────────────────────────────────────────────────────────────
  {
    "muscle_group": "Back",
    "exercise_name": "45 Degree Hyperextension",
    "how_to_do": [
      "Lock your feet securely into the 45-degree back extension bench and rest your upper thighs on the pad.",
      "Cross your arms over your chest and lower your upper body toward the floor by hinging at the hips.",
      "Squeeze your glutes and lower back to raise your torso back up.",
      "Stop when your body forms a straight line from your head to your heels."
    ],
    "pro_tip": "Do not aggressively hyper-extend your lower back at the top of the movement. Stop at a perfectly straight line to protect your lumbar spine."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Back Extension",
    "how_to_do": [
      "Lie face down on a flat mat with your arms extended in front of you or lightly behind your head.",
      "Squeeze your glutes and lower back to simultaneously lift your chest and legs off the floor.",
      "Hold the 'Superman' position for a second at the top.",
      "Slowly lower back down to the floor."
    ],
    "pro_tip": "Keep your neck in a neutral position by staring directly down at the floor, rather than looking up and straining your cervical spine."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Band Bent-over Row",
    "how_to_do": [
      "Stand on the center of a resistance band with your feet shoulder-width apart.",
      "Hinge forward at the hips, keeping your back completely flat and gripping the ends of the band.",
      "Pull the band upward toward your belly button, driving your elbows toward the ceiling.",
      "Slowly extend your arms back down."
    ],
    "pro_tip": "Imagine your hands are just hooks. Focus entirely on pulling your elbows backward to disengage the biceps and isolate the lats."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Band Kneeling One Arm Pulldown",
    "how_to_do": [
      "Anchor a resistance band high above you.",
      "Kneel on the floor facing the anchor point and grab the band with one hand.",
      "Keep your chest up and pull the band straight down, driving your elbow toward your back pocket.",
      "Control the band as it returns to a full stretch at the top."
    ],
    "pro_tip": "Lean slightly into the working side to get a massive stretch along your lat muscle at the top of the movement."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Band One Arm Twisting Seated Row",
    "how_to_do": [
      "Anchor a resistance band at chest height and sit on the floor or a bench facing it.",
      "Grip the band with one hand and start with your arm fully extended.",
      "Pull the band toward your ribs, twisting your torso slightly toward the working arm as you pull.",
      "Slowly return to the start, untwisting your torso."
    ],
    "pro_tip": "The twist should happen entirely in your upper back (thoracic spine). Keep your hips completely squared and locked forward."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Band One Leg Kickback Bent Position",
    "how_to_do": [
      "Anchor a band low to the ground and face the anchor.",
      "Hinge forward so your torso is almost parallel to the floor, balancing on one leg for stability.",
      "Hold the band with the opposite arm and push your straight arm backward toward your hips (lat pushdown).",
      "Slowly return to the starting position."
    ],
    "pro_tip": "Keep your elbow locked with a slight micro-bend. The movement must come purely from the shoulder joint to isolate the lats."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Band Pull Through",
    "how_to_do": [
      "Anchor a band low to the ground and stand facing away from it, straddling the band.",
      "Reach between your legs and grip the band with both hands.",
      "Hinge at the hips to let the band pull your hands back between your legs.",
      "Drive your hips forward and squeeze your glutes and lower back to stand up straight."
    ],
    "pro_tip": "This is a hip hinge, not a squat. Push your glutes backward to the wall behind you rather than bending your knees deeply."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Band Pull-Apart",
    "how_to_do": [
      "Stand tall holding a light resistance band directly in front of your chest with straight arms.",
      "Keep your arms straight and pull the band apart horizontally until it touches your sternum.",
      "Squeeze your shoulder blades together hard.",
      "Return the band to the front under control."
    ],
    "pro_tip": "Keep your shoulders depressed (pushed down) the entire time. If your shoulders shrug up to your ears, your upper traps will take over from your rear delts."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Band Seated Row",
    "how_to_do": [
      "Sit on the floor with your legs extended in front of you.",
      "Loop the resistance band securely around the arches of your feet and hold the ends.",
      "Sit up perfectly straight and pull the band toward your stomach, retracting your shoulder blades.",
      "Release slowly, maintaining your upright posture."
    ],
    "pro_tip": "Do not lean back as you pull! Rocking backward uses your lower back and momentum instead of isolating your mid-back muscles."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Band Straight Back Seated Row",
    "how_to_do": [
      "Sit on the floor or a bench with the band anchored securely in front of you.",
      "Keep your back completely flat and your chest puffed out.",
      "Pull your elbows straight back, keeping them close to your ribs.",
      "Squeeze your lats and mid-back, then return to the starting position."
    ],
    "pro_tip": "Pause for a full second at the back of the movement. Isometric holds with bands are incredibly effective for building mind-muscle connection in the back."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Band-Assisted Pull Up",
    "how_to_do": [
      "Loop a heavy resistance band securely over a pull-up bar.",
      "Place one foot or knee into the bottom loop of the band.",
      "Hang from the bar with an overhand grip.",
      "Pull your chest up to the bar, letting the band assist you, then lower down slowly."
    ],
    "pro_tip": "Do not drop quickly! The band wants to snap you back down. Control the eccentric (lowering) phase for 3 seconds to build the strength needed for unassisted pull-ups."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Barbell Bent-Over Row",
    "how_to_do": [
      "Stand with your feet shoulder-width apart, holding a barbell with an overhand grip.",
      "Hinge at the hips until your torso is nearly parallel to the floor, keeping your back flat.",
      "Pull the barbell up toward your lower ribs/belly button.",
      "Lower the bar under control until your arms are fully extended."
    ],
    "pro_tip": "Your torso angle dictates what muscles you work. Staying parallel to the floor targets the lats and mid-back, while standing more upright shifts the focus to the upper traps."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Barbell Bent-over Row Overgrip",
    "how_to_do": [
      "Use a pronated (palms facing you) grip on the barbell, hands slightly wider than shoulder-width.",
      "Hinge forward at the hips with a flat back.",
      "Row the bar toward your upper stomach, allowing your elbows to flare out slightly.",
      "Control the weight back down."
    ],
    "pro_tip": "Flaring the elbows out to about 45 degrees heavily targets the rhomboids, rear delts, and upper back, creating that thick, 3D look."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Barbell Rear Delt Raise",
    "how_to_do": [
      "Take a very wide overhand grip on a barbell.",
      "Hinge over until your torso is strictly parallel to the floor.",
      "Pull the bar directly up toward your upper chest/collarbone, keeping your elbows flared wide.",
      "Squeeze your rear deltoids and upper back, then lower the bar."
    ],
    "pro_tip": "Use significantly lighter weight than a standard row. The goal is to isolate the small rear deltoid muscles, not to move maximum weight."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Barbell Shrug",
    "how_to_do": [
      "Stand tall holding a barbell in front of your thighs with a shoulder-width grip.",
      "Keep your arms perfectly straight.",
      "Elevate your shoulders straight up toward your ears as high as possible.",
      "Hold for a brief second, then lower your shoulders back down."
    ],
    "pro_tip": "Pull straight up and straight down. Rolling your shoulders in a circular motion grinds the rotator cuff and adds zero benefit to trap development."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Barbell Straight Leg Deadlift",
    "how_to_do": [
      "Stand with feet hip-width apart holding a barbell with an overhand grip.",
      "Keep a slight, locked micro-bend in your knees.",
      "Hinge your hips straight backward, lowering the bar down your legs until you feel a massive hamstring stretch.",
      "Drive your hips forward to stand back up, squeezing your glutes."
    ],
    "pro_tip": "Keep the barbell physically touching your legs the entire time. If the bar drifts away from your body, it places extreme, dangerous shearing force on your lower back."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Barbell Underhand Bent-over Row",
    "how_to_do": [
      "Grip the barbell with a supinated (underhand) grip, roughly shoulder-width apart.",
      "Hinge at the hips, keeping a flat back.",
      "Pull the bar tightly into your belly button, keeping your elbows dragged closely against your ribs.",
      "Lower the bar back to a full stretch."
    ],
    "pro_tip": "The underhand grip naturally forces your elbows tight to your body, making this one of the greatest exercises for building the lower lat sweep."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Bench Pull-ups",
    "how_to_do": [
      "Set a barbell securely in a rack or use a Smith machine bar at waist height.",
      "Lie under the bar and grip it slightly wider than shoulder-width.",
      "Keeping your body in a perfectly straight line with your heels on the floor (or elevated on a bench), pull your chest up to the bar.",
      "Lower yourself smoothly back down."
    ],
    "pro_tip": "Squeeze your glutes and brace your core. If your hips sag toward the floor, you lose the core stability required to properly engage your back."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Cable Bar Lateral Pulldown (reverse-grip)",
    "how_to_do": [
      "Attach a lat pulldown bar and take a shoulder-width underhand grip.",
      "Sit down, securing your knees under the pads.",
      "Pull the bar down toward your lower chest, driving your elbows straight down.",
      "Return the bar to the top, getting a full stretch in the lats."
    ],
    "pro_tip": "Drive your elbows down and back as if you are trying to elbow someone standing directly behind you. This cues the lats perfectly."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Cable Bar Lateral Pulldown (wide shoulder grip)",
    "how_to_do": [
      "Grasp the wide lat pulldown bar with an overhand grip, hands wider than shoulder-width.",
      "Sit securely under the knee pads.",
      "Pull the bar down to your upper chest, arching your upper back slightly.",
      "Control the weight back up to full arm extension."
    ],
    "pro_tip": "Always pull to the front of your chest. Pulling the bar behind your neck forces the shoulders into extreme external rotation and invites injury."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Cable Close Grip Front Lat Pulldown",
    "how_to_do": [
      "Attach a V-bar handle to the high pulley.",
      "Sit under the pads, lean back slightly, and puff your chest out.",
      "Pull the V-bar down to your lower sternum.",
      "Squeeze your shoulder blades together, then release slowly to a full stretch."
    ],
    "pro_tip": "The V-bar allows for an incredible stretch at the top. Let your shoulders rise slightly at the absolute top of the movement to fully open up the lat muscles."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Cable One Arm Lateral Pulldown",
    "how_to_do": [
      "Attach a single D-handle to the high pulley.",
      "Sit down or kneel on one knee, gripping the handle with one hand.",
      "Pull the handle straight down, tucking your elbow tightly into your side.",
      "Slowly let the handle rise, feeling the intense unilateral stretch."
    ],
    "pro_tip": "Place your non-working hand on the lat muscle you are pulling with. Feeling the muscle contract physically helps build the mind-muscle connection."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Cable One Arm Twisting Seated Row",
    "how_to_do": [
      "Attach a D-handle to a seated row cable machine.",
      "Sit tall and grab the handle with one arm, letting it stretch your shoulder forward slightly.",
      "Pull the handle to your hip, twisting your torso slightly to open up your chest on the pulling side.",
      "Untwist and return to the fully stretched starting position."
    ],
    "pro_tip": "Do not let your lower back round forward when the cable pulls you. Maintain a rigid lumbar spine and only twist the upper thoracic spine."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Cable Pulldown",
    "how_to_do": [
      "Sit at the lat pulldown machine and grip the bar slightly wider than shoulder-width.",
      "Lock your knees under the pads and lean back about 10 degrees.",
      "Drive your elbows down to pull the bar to your upper chest.",
      "Slowly return the bar to the starting position."
    ],
    "pro_tip": "Initiate every single rep by first dropping your shoulder blades down and back (scapular depression) before your elbows even begin to bend."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Cable Seated High Row (V-bar)",
    "how_to_do": [
      "Set a cable pulley to chest or head height and attach a V-bar.",
      "Sit on a bench facing the machine with your feet planted.",
      "Pull the V-bar toward your upper chest or neck.",
      "Squeeze the upper back and rear delts, then release."
    ],
    "pro_tip": "Keep your elbows elevated (flared out) as you pull. This directly shifts the mechanical tension onto the mid/upper traps and rhomboids."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Cable Seated Row (normal grip)",
    "how_to_do": [
      "Sit at the low row cable machine and attach a standard straight bar.",
      "Take a shoulder-width overhand grip.",
      "Keeping your torso upright and stationary, pull the bar to your stomach.",
      "Extend your arms back out under control."
    ],
    "pro_tip": "Do not use your lower back to heave the weight. If your torso is swinging back and forth more than 10 degrees, the weight is too heavy."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Cable Seated Row (parallel grip)",
    "how_to_do": [
      "Attach a V-bar or parallel grip handle to the seated row machine.",
      "Sit with your knees slightly bent and your back straight.",
      "Pull the handle into your belly button, keeping your elbows tucked tight against your sides.",
      "Squeeze your back, then slowly let the weight stretch your arms forward."
    ],
    "pro_tip": "Puff your chest out like a gorilla as the handle reaches your stomach. This ensures maximum scapular retraction."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Cable Seated Row (wide-grip)",
    "how_to_do": [
      "Attach a long lat bar to the seated row machine and take a wide overhand grip.",
      "Sit tall with your chest up.",
      "Pull the bar toward your lower chest, keeping your elbows flared out to the sides.",
      "Control the weight back to the start."
    ],
    "pro_tip": "The wide grip shifts the focus from the lats to the upper back. Think about squeezing a pencil between your shoulder blades at the peak of the movement."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Cable Straight Arm Pulldown",
    "how_to_do": [
      "Attach a straight bar or rope to the highest pulley setting.",
      "Stand facing the machine, grab the attachment, and step back, hinging slightly at the hips.",
      "Keeping your arms almost completely straight, push the bar down in an arc until it hits your thighs.",
      "Slowly raise the bar back up to about eye level."
    ],
    "pro_tip": "Lock a slight micro-bend in your elbows and freeze them there. The movement must come 100% from the shoulder joint sweeping down to hit the lats."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Cable Straight Back Seated High Row (reverse-grip)",
    "how_to_do": [
      "Attach a straight bar to a chest-height cable and take an underhand grip.",
      "Sit upright with your chest proud.",
      "Pull the bar toward your lower chest, dragging your elbows tightly past your ribs.",
      "Slowly return to the start."
    ],
    "pro_tip": "The underhand grip naturally drops your shoulders. Use this variation if you constantly struggle with your upper traps taking over during back exercises."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Cable Straight Back Seated Row (V-grip)",
    "how_to_do": [
      "Sit at the standard cable row machine with a V-grip attachment.",
      "Lock your spine perfectly vertical—zero forward or backward lean.",
      "Pull the V-bar strictly to your belly button.",
      "Release the weight slowly, stopping just before your lower back begins to round forward."
    ],
    "pro_tip": "By enforcing a strict, totally vertical back, you remove all momentum. This forces the lats to work twice as hard to move the load."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Cambered Bar Lying Row",
    "how_to_do": [
      "Lie face down on a high flat bench or cambered row bench.",
      "Grip the barbell hanging beneath you.",
      "Pull the bar up until it touches the underside of the bench.",
      "Lower the bar back down to a dead hang."
    ],
    "pro_tip": "Chest-supported rows completely eliminate lower back fatigue. Let your shoulders protract (sink down) completely at the bottom for a deep lat stretch."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Chin Up",
    "how_to_do": [
      "Grip the pull-up bar with a supinated (underhand) grip, shoulder-width apart.",
      "Hang with your arms fully extended and core braced.",
      "Pull your body up until your chin clears the bar or your collarbone touches it.",
      "Lower yourself back down in a controlled manner."
    ],
    "pro_tip": "Do not just pull with your arms. Drive your elbows straight down toward the floor to activate the lats rather than just the biceps."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Chin-ups  Pull-Ups",
    "how_to_do": [
      "Grab the overhead bar with your preferred grip (overhand or underhand).",
      "Start from a dead hang with straight arms.",
      "Pull your body vertically until your chin is over the bar.",
      "Lower yourself smoothly back to a complete dead hang."
    ],
    "pro_tip": "Cross your ankles behind you and squeeze your glutes. This simple trick turns your body into a rigid log, instantly preventing energy-wasting swinging."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Chin-ups (narrow parallel grip)",
    "how_to_do": [
      "Use the close parallel handles (palms facing each other) on a pull-up station.",
      "Hang fully extended.",
      "Pull your chest up toward the handles, arching your upper back slightly.",
      "Control the descent back to straight arms."
    ],
    "pro_tip": "The narrow neutral grip is the absolute safest variation for the shoulder and wrist joints, allowing you to safely pull maximum weight."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Close Grip Chin-up",
    "how_to_do": [
      "Grip the bar with an underhand grip, hands placed only a few inches apart.",
      "Hang straight down.",
      "Pull your body up, focusing heavily on the contraction in your biceps and lower lats.",
      "Lower yourself under control."
    ],
    "pro_tip": "Because the hands are so close, this heavily biases the biceps. It is an excellent functional mass-builder for the arms."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Commando Pull Up",
    "how_to_do": [
      "Stand under the pull-up bar so it runs perpendicular to you.",
      "Grasp the bar with one hand directly in front of the other (baseball bat grip).",
      "Pull your body up, tilting your head to clear the right side of the bar.",
      "Lower down, then pull up again, tilting your head to clear the left side of the bar."
    ],
    "pro_tip": "Switch your grip (front hand to back hand) halfway through your sets to ensure symmetrical development across your lats and core."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Conventional Deadlift",
    "how_to_do": [
      "Stand with your mid-foot under the barbell, feet hip-width apart.",
      "Bend over and grip the bar just outside your legs.",
      "Drop your hips, puff your chest out to flatten your back, and brace your core.",
      "Drive through your feet to stand up with the weight, dragging the bar up your shins."
    ],
    "pro_tip": "The deadlift is a push, not a pull. Think about leg-pressing the floor away from you rather than trying to yank the bar up with your back."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Dumbbell Bent-over Row",
    "how_to_do": [
      "Hold a dumbbell in each hand and hinge forward at the hips until your back is nearly parallel to the floor.",
      "Keep a slight bend in your knees and a flat back.",
      "Pull the dumbbells up toward your hips, keeping your elbows tucked.",
      "Slowly lower the weights back to a dead hang."
    ],
    "pro_tip": "Row the dumbbells in a slight arc toward your waistline (like sawing wood), rather than pulling them straight up to your chest."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Dumbbell Deadlift",
    "how_to_do": [
      "Stand holding a heavy dumbbell in each hand by your sides.",
      "Keeping your chest up, push your hips back and bend your knees to lower the weights toward the floor.",
      "Stop when the dumbbells reach mid-shin level.",
      "Push through the floor to stand back up, squeezing the glutes at the top."
    ],
    "pro_tip": "Keep the dumbbells tracking exactly over the center of your feet. If they drift forward, the weight will pull your lower back out of alignment."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Dumbbell Hammer Grip Incline Bench Row",
    "how_to_do": [
      "Set a bench to a 30-45 degree incline and lie face down with your chest on the pad.",
      "Hold dumbbells hanging straight down with a neutral (hammer) grip.",
      "Row the weights upward, pulling your elbows high.",
      "Control the descent back to the starting position."
    ],
    "pro_tip": "Actively press your chest into the bench pad as you pull. This absolutely guarantees zero momentum is used to lift the weights."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Dumbbell Incline Row",
    "how_to_do": [
      "Lie prone on an incline bench holding dumbbells.",
      "Let your arms hang fully extended to stretch the back.",
      "Pull the dumbbells up toward your ribs, focusing on retracting the scapula.",
      "Slowly lower the weights back down."
    ],
    "pro_tip": "To target the upper back, flare your elbows out slightly. To target the lats, keep your elbows dragged tightly against your sides."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Dumbbell Incline Shrug",
    "how_to_do": [
      "Lie face down on a high incline bench holding a dumbbell in each hand.",
      "Let your arms hang straight down.",
      "Keeping your arms locked straight, shrug your shoulders back and up together.",
      "Squeeze your mid-traps hard, then relax back down."
    ],
    "pro_tip": "Standard standing shrugs hit the upper traps. Doing them chest-supported on an incline directly hits the mid and lower traps, which drastically improves posture."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Dumbbell Lying Rear Delt Row",
    "how_to_do": [
      "Lie face down on a flat or low-incline bench holding light dumbbells.",
      "Turn your palms to face your feet (pronated grip).",
      "Row the dumbbells upward by flaring your elbows out 90 degrees from your body.",
      "Squeeze the back of your shoulders at the top, then lower."
    ],
    "pro_tip": "Imagine you are trying to pull your elbows apart to opposite sides of the room, rather than just pulling the weight up."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Dumbbell Palm Rotational Bent Over Row",
    "how_to_do": [
      "Hinge forward holding dumbbells with a pronated grip (palms facing your legs).",
      "As you pull the dumbbells up toward your waist, rotate your wrists outward.",
      "Finish the row with a supinated grip (palms facing forward).",
      "Reverse the rotation as you lower the weights."
    ],
    "pro_tip": "This twisting motion forces a deeper, more intense contraction in the lower lats as you pull the elbow toward the hip."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Dumbbell Reverse Grip Row",
    "how_to_do": [
      "Hinge at the hips, holding dumbbells with a supinated (palms facing forward) grip.",
      "Row the dumbbells into your stomach, keeping your elbows scraping your sides.",
      "Squeeze the lats at the top.",
      "Slowly lower back to full arm extension."
    ],
    "pro_tip": "The reverse grip naturally keeps your elbows from flaring out, making it impossible for the upper back to steal the work from your lats."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Dumbbell Row",
    "how_to_do": [
      "Place one knee and the same-side hand firmly on a flat bench.",
      "Keep your back flat and hold a dumbbell in your free hand, hanging toward the floor.",
      "Pull the dumbbell up toward your hip, keeping your elbow close to your body.",
      "Lower the dumbbell in a controlled arc back to the starting point."
    ],
    "pro_tip": "Do not pull the dumbbell straight up to your chest. Row it back toward your hip in a sweeping 'J' motion to properly engage the lat."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Dumbbell Shrug",
    "how_to_do": [
      "Stand tall holding a heavy dumbbell in each hand by your sides.",
      "Keep your arms completely straight and your head looking forward.",
      "Shrug your shoulders straight up toward your ears.",
      "Hold the peak contraction for one second, then lower down slowly."
    ],
    "pro_tip": "Avoid 'turtling' your neck forward as you shrug. Keep your chin tucked back to protect your cervical spine and isolate the trapezius muscles."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Dumbbell Stiff Leg Deadlift",
    "how_to_do": [
      "Stand holding dumbbells in front of your thighs.",
      "Keep a slight micro-bend in your knees and lock them in place.",
      "Hinge at the hips, pushing them back to lower the weights down the front of your legs.",
      "Squeeze your hamstrings and glutes to pull your torso back to a standing position."
    ],
    "pro_tip": "Do not lock out your hips completely at the top of the movement. Stopping an inch shy of standing straight up keeps constant tension on the posterior chain."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Hammer Grip Pull-up",
    "how_to_do": [
      "Grasp the parallel bars on a pull-up station (palms facing each other).",
      "Hang from the bars with arms fully extended.",
      "Pull your body up until your chin clears your hands.",
      "Lower yourself back to a dead hang."
    ],
    "pro_tip": "The neutral (hammer) grip is mechanically the strongest pulling position. Use this grip when you want to attach a weight belt and push maximum loads."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "High Row to Neck",
    "how_to_do": [
      "Attach a rope or wide bar to a seated cable row machine.",
      "Sit upright and pull the attachment high, aiming directly for your collarbone or lower neck.",
      "Flare your elbows out high and wide as you pull.",
      "Squeeze the upper back and rear delts, then slowly extend."
    ],
    "pro_tip": "Use significantly less weight than a standard row. Pulling high severely limits lat involvement and forces the small upper back muscles to do all the work."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Inverted Row",
    "how_to_do": [
      "Set a barbell in a rack at waist height.",
      "Lie under the bar and grip it slightly wider than shoulder-width.",
      "Keep your body in a straight plank line from your head to your heels.",
      "Pull your chest up to touch the bar, then lower yourself smoothly."
    ],
    "pro_tip": "If this is too difficult, bend your knees and place your feet flat on the floor. To make it harder, elevate your feet on a bench."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Inverted Row Between Chairs",
    "how_to_do": [
      "Place two extremely sturdy chairs facing each other and lay a strong broomstick or pipe across them.",
      "Lie on the floor underneath the stick.",
      "Grip the stick and keep your body rigid.",
      "Pull your chest up to the stick, then lower back down."
    ],
    "pro_tip": "Safety first: Ensure the chairs are weighted down and the stick is structurally sound enough to hold your bodyweight before attempting this home variation."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Inverted Row With Straps",
    "how_to_do": [
      "Hold the handles of a TRX or suspension strap setup.",
      "Walk your feet forward and lean back until tension is on the straps.",
      "Keep your body perfectly straight and pull your chest up to your hands.",
      "Lower yourself back to straight arms."
    ],
    "pro_tip": "You control the exact difficulty. Stepping your feet closer to the anchor point makes you more horizontal and increases the resistance."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Kettlebell Deadlift",
    "how_to_do": [
      "Place a heavy kettlebell on the floor exactly between your ankles.",
      "Hinge at the hips, bend your knees, and grip the kettlebell handle with both hands.",
      "Flatten your back, brace your core, and drive through your heels to stand up.",
      "Hinge back down, returning the kettlebell to the floor between your feet."
    ],
    "pro_tip": "Do not place the kettlebell out in front of your toes. Setting up with the weight between your ankles protects your lower back from dangerous leverage."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Kneeling Lat Pulldown",
    "how_to_do": [
      "Attach a bar to a high cable pulley.",
      "Grip the bar and drop down onto both knees, sitting back slightly on your heels.",
      "Pull the bar down to your upper chest, arching your upper back slightly.",
      "Let the bar pull your arms back up to a full stretch."
    ],
    "pro_tip": "Kneeling rather than sitting allows your torso to travel through a much greater range of motion, giving the lats an unparalleled stretch at the top."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Landmine Row",
    "how_to_do": [
      "Secure one end of a barbell in a landmine attachment and load plates on the other end.",
      "Straddle the bar, facing away from the landmine, and hook a V-grip handle under the bar behind the plates.",
      "Hinge forward with a flat back.",
      "Pull the handle into your stomach, squeezing your back, then lower."
    ],
    "pro_tip": "Load the bar using multiple 25-pound plates rather than 45-pound plates. The smaller diameter plates allow you to row the bar much deeper into your stomach."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Lat Pulldown",
    "how_to_do": [
      "Sit at the pulldown machine and grab the bar with a wide overhand grip.",
      "Lock your legs tightly under the pads.",
      "Pull the bar straight down to your upper chest, leading the pull with your elbows.",
      "Slowly let the bar back up to full extension."
    ],
    "pro_tip": "Slightly lean back (about 10 degrees) but lock your torso there. Do not swing your body back and forth to jerk the weight down."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Lever Back Extension",
    "how_to_do": [
      "Sit in the machine and adjust the back pad so it rests securely across your upper back/shoulder blades.",
      "Place your feet firmly on the footplates.",
      "Push backward against the pad by extending your lower back.",
      "Slowly let the machine push you forward to the starting position."
    ],
    "pro_tip": "Ensure the machine's axis of rotation lines up perfectly with your hip joints. Improper alignment will place harsh grinding forces on your lumbar spine."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Lever High Row",
    "how_to_do": [
      "Sit at the plate-loaded high row machine and press your chest firmly against the pad.",
      "Reach up and grasp the handles.",
      "Pull the handles down and back, driving your elbows behind you.",
      "Control the handles as they return to the top."
    ],
    "pro_tip": "Keep your chest glued to the pad. The moment your chest lifts off, you are engaging your lower back to help pull, entirely defeating the isolation."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Lever Reverse Hyperextension",
    "how_to_do": [
      "Lie face down on the reverse hyper machine with your hips at the edge of the pad.",
      "Hook your ankles into the pendulum straps.",
      "Keeping your legs straight, lift them backward and up until they are parallel to the floor.",
      "Control the pendulum as it swings back down."
    ],
    "pro_tip": "Control the swing at the bottom! Do not let the heavy pendulum violently yank your legs and lower back under the machine."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Lever Reverse T-Bar Row",
    "how_to_do": [
      "Lie chest-down on the T-bar machine pad.",
      "Take a pronated (overhand) or neutral grip on the handles.",
      "Pull the weight up toward your chest, squeezing your shoulder blades together.",
      "Lower the weight back to a full stretch."
    ],
    "pro_tip": "Use a thumbless (suicide) grip on the handles. This simple adjustment prevents your forearms and biceps from taking over the workload."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Lever Shrug",
    "how_to_do": [
      "Stand in the shrug machine or hex bar, gripping the handles at your sides.",
      "Keep your arms perfectly straight.",
      "Shrug your shoulders straight upward, aiming for your ears.",
      "Pause for a heavy contraction at the top, then lower smoothly."
    ],
    "pro_tip": "Machines remove the need to balance the weight, meaning you can load this significantly heavier than dumbbells. Push the weight, but maintain the 1-second pause at the top."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Lever T-bar Row",
    "how_to_do": [
      "Stand on the footplates and hinge forward to grasp the T-bar handles.",
      "Keep your back flat and your chest up.",
      "Pull the bar into your stomach.",
      "Lower the weight under control until your arms are fully extended."
    ],
    "pro_tip": "Keep your head in a neutral line with your spine. Cranking your neck backward to look in the mirror while lifting heavy places severe stress on the cervical discs."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Pull Up",
    "how_to_do": [
      "Hang from a pull-up bar with an overhand grip slightly wider than shoulder-width.",
      "Engage your core and pull your body upward.",
      "Aim to clear the bar with your chin or touch it with your upper chest.",
      "Lower yourself back to a strict dead hang."
    ],
    "pro_tip": "Pretend you are trying to bend the bar in half as you pull. This mental cue perfectly engages the lats and forces you into the correct pulling posture."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Pull-up (shoulder grip)",
    "how_to_do": [
      "Grip the bar exactly at shoulder-width with an overhand grip.",
      "Start from a dead hang.",
      "Pull your body up vertically.",
      "Lower yourself smoothly back down."
    ],
    "pro_tip": "The shoulder-width grip offers the perfect mechanical balance between the lats and biceps, making it ideal for maximizing total pulling volume."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Pull-up (wide back grip)",
    "how_to_do": [
      "Take a very wide overhand grip on the bar.",
      "Pull your body upward while shifting your head forward.",
      "Touch the back of your neck to the bar.",
      "Lower down slowly to the start."
    ],
    "pro_tip": "WARNING: Behind-the-neck movements require elite shoulder mobility. If you experience any shoulder pain or stiffness, immediately switch to standard front pull-ups."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Pull-up (wide front grip)",
    "how_to_do": [
      "Take a wide overhand grip on the bar (hands significantly wider than your shoulders).",
      "Pull your chest up toward the bar, leaning back slightly.",
      "Focus intensely on your back muscles contracting.",
      "Lower yourself to full extension."
    ],
    "pro_tip": "Because the wide grip limits your range of motion and puts you at a mechanical disadvantage, focus on pulling your elbows down and in, rather than just pulling your body up."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Reverse Grip Machine Lat Pulldown",
    "how_to_do": [
      "Sit in the plate-loaded pulldown machine and grab the handles with an underhand (supinated) grip.",
      "Secure your knees under the pads.",
      "Pull the handles down to your chest, keeping your elbows tucked tight to your ribs.",
      "Control the weight as it rises."
    ],
    "pro_tip": "The machine path forces a perfect arc. Squeeze your lower lats as hard as possible at the absolute bottom of the movement."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Reverse Grip Pull-up",
    "how_to_do": [
      "Take an underhand (palms facing you) grip on the bar, about shoulder-width apart.",
      "Hang fully extended.",
      "Pull your chest to the bar, keeping your elbows close to your body.",
      "Lower back down to a dead hang."
    ],
    "pro_tip": "Also known as a Chin-Up. Focus on pulling your elbows straight down to the floor to maximize lower lat activation alongside the heavy bicep work."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Reverse Hyperextension",
    "how_to_do": [
      "Lie face down on a reverse hyper bench or a high flat bench, letting your legs hang off the edge.",
      "Grip the front of the bench to anchor your upper body.",
      "Keep your legs straight and lift them up behind you until they are in line with your torso.",
      "Lower them slowly back down."
    ],
    "pro_tip": "Squeeze your glutes violently at the top of the movement. This ensures the glutes take the load and protects the lower back from hyperextending."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Ring High Row",
    "how_to_do": [
      "Grip a pair of gymnastic rings and lean back, walking your feet forward.",
      "Turn your palms down (overhand grip).",
      "Pull your body up, pulling your elbows high and wide to the sides.",
      "Lower yourself smoothly back to straight arms."
    ],
    "pro_tip": "Keep your elbows flared strictly at shoulder height. Dropping your elbows turns this into a lat row rather than targeting the rear delts and upper traps."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Scapula Dips",
    "how_to_do": [
      "Support yourself on parallel dip bars with your arms completely locked straight.",
      "Without bending your elbows, let your body sink down as your shoulders shrug up toward your ears.",
      "Push the bars away to elevate your body, driving your shoulders down.",
      "Hold the top position for a second."
    ],
    "pro_tip": "Keep your arms rigidly straight. The entire movement is just a few inches of travel controlled entirely by the scapula (shoulder blades) moving up and down."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Seated Cable Row",
    "how_to_do": [
      "Sit at the cable row machine with your feet planted and a slight bend in your knees.",
      "Grip the handle, sit up tall, and pull the handle into your stomach.",
      "Squeeze your shoulder blades together.",
      "Slowly extend your arms, letting your shoulders pull forward slightly at the end for a stretch."
    ],
    "pro_tip": "Allowing your shoulders to slightly protract (roll forward) at the bottom of the movement creates a massive stretch that triggers lat hypertrophy."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Single Dumbbell Stiff Leg Deadlift",
    "how_to_do": [
      "Stand holding a single heavy dumbbell with both hands in front of you.",
      "Keep your knees slightly bent and locked.",
      "Hinge at the hips to lower the dumbbell straight down toward the floor.",
      "Drive your hips forward to stand back up."
    ],
    "pro_tip": "Keep the dumbbell tracking right against your legs. Letting it swing out like a pendulum places destructive leverage on your lumbar spine."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Single Leg Romanian Deadlift",
    "how_to_do": [
      "Stand on one leg, holding a dumbbell in the opposite hand.",
      "Hinge at the hips, pushing your free leg straight back behind you for balance.",
      "Lower the dumbbell toward the floor, keeping your back flat.",
      "Squeeze the glute and hamstring of your planted leg to stand back up."
    ],
    "pro_tip": "Pick a single spot on the floor 3 feet in front of you and stare at it. Locking your visual focus is the secret to maintaining balance during this movement."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Smith Deadlift - Deadlift",
    "how_to_do": [
      "Stand with the Smith machine bar over your mid-foot.",
      "Hinge down and grip the bar.",
      "Drop your hips, puff your chest, and drive through the floor to stand up.",
      "Lower the bar back to the floor smoothly."
    ],
    "pro_tip": "Because the Smith machine locks the bar path to a strict vertical line, experiment with your foot placement until the bar easily clears your knees without scraping your shins."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Stigv-Leg Deadlift",
    "how_to_do": [
      "Stand with a barbell over your mid-foot, feet hip-width apart.",
      "Keep your knees almost completely straight, but not aggressively locked backwards.",
      "Hinge at the hips to lower the bar down your legs.",
      "Push your hips forward to pull the weight back to the top."
    ],
    "pro_tip": "Only go down as far as your hamstring flexibility allows while maintaining a flat back. If your lower back rounds like a cat to reach the floor, stop immediately."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Straight Arm Pulldown",
    "how_to_do": [
      "Attach a straight bar to the high cable pulley.",
      "Take a shoulder-width overhand grip and step back to create tension.",
      "Keeping your arms locked with a slight bend, push the bar down to your thighs in a sweeping arc.",
      "Control the bar back up to eye level."
    ],
    "pro_tip": "Puff your chest out and arch your upper back slightly. This posture forces the lats to do the work rather than the shoulders or triceps."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Stretching - Dynamic Back Stretch",
    "how_to_do": [
      "Stand tall with feet shoulder-width apart.",
      "Swing both arms across your body, letting them wrap around your torso like a self-hug.",
      "Immediately swing them out wide to open your chest.",
      "Repeat the swinging motion continuously for 30 seconds."
    ],
    "pro_tip": "Keep the movement fluid and loose. This is a dynamic warm-up designed to push blood into the back and chest muscles before lifting heavy."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Stretching - Elbows Back Stretch",
    "how_to_do": [
      "Sit or stand tall.",
      "Place your hands on your lower back or hips.",
      "Gently pull both of your elbows directly backward, trying to make them touch behind your back.",
      "Hold the stretch across your chest and front delts for 20 seconds."
    ],
    "pro_tip": "As you pull your elbows back, simultaneously squeeze your shoulder blades together. This actively engages the back while stretching the opposing chest muscles."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Stretching - Kneeling Lat Stretch",
    "how_to_do": [
      "Kneel on the floor in front of a bench or chair.",
      "Place both elbows on the edge of the bench, with your hands clasped together behind your neck.",
      "Drop your chest and head down between your arms toward the floor.",
      "Hold the stretch deeply in your lats and armpits."
    ],
    "pro_tip": "To intensify the stretch, slightly round your lower back (tuck your tailbone) as you push your chest down."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Stretching - Middle Back Stretch",
    "how_to_do": [
      "Stand tall and extend your arms straight out in front of you.",
      "Clasp your hands together and push them away from your body.",
      "Tuck your chin to your chest and round your upper back, spreading your shoulder blades wide.",
      "Hold for 30 seconds, breathing deeply."
    ],
    "pro_tip": "Imagine you are hugging a massive beach ball. Pushing your hands forward actively separates the rhomboids for a deep mid-back stretch."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Stretching - Neck Side Stretch",
    "how_to_do": [
      "Sit or stand with perfect posture.",
      "Reach your right hand over your head and gently pull your right ear toward your right shoulder.",
      "Reach your left hand down toward the floor to deepen the stretch along the left side of your neck and trap.",
      "Hold for 20 seconds, then switch sides."
    ],
    "pro_tip": "Do not forcefully yank your head. The neck is delicate; use only the gentle weight of your hand to guide the stretch."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Stretching - Seated Lower Back Stretch",
    "how_to_do": [
      "Sit in a sturdy chair with your feet flat on the floor.",
      "Slowly bend forward, dropping your chest between your knees.",
      "Let your arms hang loosely down toward your feet.",
      "Relax your neck and let your lower back stretch for 30-45 seconds."
    ],
    "pro_tip": "Breathe deep into your belly. Expanding the diaphragm pushes against the lower back from the inside, significantly deepening the stretch."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Stretching - Seated Wide Angle Pose Sequence",
    "how_to_do": [
      "Sit on the floor and spread your legs as wide as comfortably possible.",
      "Keep your back straight and walk your hands forward on the floor between your legs.",
      "Lower your chest toward the floor.",
      "Hold the stretch in your lower back and inner thighs."
    ],
    "pro_tip": "Keep your toes pointing straight up at the ceiling. Letting your feet flop outward removes the tension from the hamstrings and back."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Stretching - Sitting Bent Over Back Stretch",
    "how_to_do": [
      "Sit on the floor with your legs straight out in front of you.",
      "Hinge forward at the hips and reach for your toes.",
      "Let your upper back round naturally.",
      "Hold the position, focusing on relaxing the spine for 30 seconds."
    ],
    "pro_tip": "If you cannot reach your toes, simply grab your shins. The goal is to relax the spine, not to painfully force flexibility."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Stretching - Slopes Towards Stretch",
    "how_to_do": [
      "Stand facing a wall or sturdy object about an arm's length away.",
      "Place your hands flat on the wall at shoulder height.",
      "Hinge at the hips, keeping your legs straight, and push your chest down toward the floor.",
      "Hold the flat-back stretch, opening the lats and hamstrings."
    ],
    "pro_tip": "Push your hips actively backward away from the wall to increase the traction and stretch along the entire lateral line of the body."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Stretching - Spine Stretch",
    "how_to_do": [
      "Lie flat on your back on a mat.",
      "Pull both knees tightly into your chest and wrap your arms around your shins.",
      "Gently rock side to side or simply hold the knees tight to the chest.",
      "Release and lay flat."
    ],
    "pro_tip": "Tuck your chin slightly toward your chest to elongate the cervical spine and ensure your entire back is resting smoothly on the floor."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Stretching - Spine Stretch Forward",
    "how_to_do": [
      "Sit on the floor with your legs extended and slightly apart.",
      "Sit up perfectly straight and reach your arms out in front of you.",
      "Tuck your chin and roll your spine forward, segment by segment, reaching toward your feet.",
      "Slowly stack your spine back up to a seated position."
    ],
    "pro_tip": "Imagine your spine is peeling off an invisible wall behind you, one vertebra at a time. This Pilates concept builds incredible segmental spinal control."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Stretching - Standing Back Rotation Stretch",
    "how_to_do": [
      "Stand tall with feet shoulder-width apart.",
      "Extend your arms out to the sides at shoulder height.",
      "Twist your entire upper body slowly to the right, keeping your hips facing forward.",
      "Hold for a few seconds, return to center, and twist to the left."
    ],
    "pro_tip": "Your hips must remain locked forward like headlights on a car. If your hips twist, you are cheating the stretch in the thoracic spine."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "Stretching - Standing Lateral Stretch",
    "how_to_do": [
      "Stand tall with your feet together.",
      "Reach both arms straight overhead and interlock your fingers.",
      "Slowly lean your torso to the right, pushing your hips gently to the left.",
      "Hold the stretch along your lat and obliques, then switch sides."
    ],
    "pro_tip": "Actively pull your top arm with your bottom hand to physically lengthen the lat muscle on the stretched side."
  },
  {
    "muscle_group": "Back",
    "exercise_name": "T-Bar Row",
    "how_to_do": [
      "Straddle a T-bar row machine or a landmine barbell setup.",
      "Hinge at the hips with a flat back and grasp the handles.",
      "Pull the weight into your midsection, squeezing your shoulder blades together.",
      "Lower the weight back to a full stretch."
    ],
    "pro_tip": "Do not stand up as you pull the weight. Your torso must remain locked at a 45-degree angle to ensure the back takes the load, not the hips."
  },
];

async function run() {
  // exercise_metadata is keyed by exercise_name (text) — fetch all names
  const { data: dbRows, error } = await supabase
    .from('exercise_metadata')
    .select('id, exercise_name');

  if (error) throw error;
  console.log(`exercise_metadata has ${dbRows.length} rows`);

  const normalise = s => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();

  let matched = 0;
  let skipped = 0;
  const failed = [];

  for (const entry of allExercises) {
    const target = normalise(entry.exercise_name);

    // Exact match first, then partial
    let row = dbRows.find(r => normalise(r.exercise_name) === target);
    if (!row) {
      row = dbRows.find(r =>
        normalise(r.exercise_name).includes(target) || target.includes(normalise(r.exercise_name))
      );
    }

    if (!row) {
      skipped++;
      failed.push(entry.exercise_name);
      continue;
    }

    const { error: updateErr } = await supabase
      .from('exercise_metadata')
      .update({ instructions: entry.how_to_do, pro_tip: entry.pro_tip })
      .eq('id', row.id);

    if (updateErr) {
      console.error(`Update failed for "${entry.exercise_name}":`, updateErr.message);
      failed.push(entry.exercise_name);
      skipped++;
      continue;
    }

    matched++;
    console.log(`✓ ${entry.exercise_name} → "${row.exercise_name}"`);
  }

  console.log(`\nDone. Matched+updated: ${matched}, Skipped: ${skipped}`);
  if (failed.length) {
    console.log('\nFailed to match:');
    failed.forEach(n => console.log(' -', n));
  }
}

run().catch(console.error);
