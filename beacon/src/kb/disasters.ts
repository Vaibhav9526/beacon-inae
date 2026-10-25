import type { DisasterGuide, T } from './types';

export const DISASTERS: DisasterGuide[] = [
  {
    id: 'earthquake',
    emoji: '🌍',
    title: ['Earthquake', 'भूकंप'],
    keywords: ['earthquake quake tremor shaking aftershock building collapse', 'भूकंप झटका कंपन इमारत'],
    before: [
      ['Fix tall furniture and heavy items to walls. Keep heavy things on low shelves.', 'ऊँचा फ़र्नीचर और भारी सामान दीवार से कसें। भारी चीज़ें नीचे की शेल्फ़ पर रखें।'],
      ['Pick a safe spot in every room: under a sturdy table or against an inside wall, away from glass.', 'हर कमरे में सुरक्षित जगह तय करें: मज़बूत मेज़ के नीचे या अंदर की दीवार के पास, काँच से दूर।'],
      ['Practise Drop, Cover, Hold On. Keep a go-bag and a whistle by the bed.', 'झुको, ढको, पकड़ो का अभ्यास करें। बिस्तर के पास गो-बैग और सीटी रखें।'],
    ],
    during: [
      ['DROP to hands and knees, COVER your head and neck under a table or with your arms, HOLD ON until shaking stops.', 'झुको: हाथ-घुटनों पर, ढको: सिर-गर्दन मेज़ के नीचे या बाँहों से, पकड़ो: झटके रुकने तक।'],
      ['Stay inside. Do not run out or use lifts. Keep away from windows, mirrors and heavy furniture.', 'अंदर रहें। बाहर न भागें, लिफ़्ट न लें। खिड़कियों, शीशों और भारी फ़र्नीचर से दूर रहें।'],
      ['Outdoors: move to an open area away from buildings, wires, trees and bridges.', 'बाहर हों: इमारतों, तारों, पेड़ों और पुलों से दूर खुली जगह पर जाएँ।'],
      ['In a vehicle: stop in the open, stay inside with the seatbelt on.', 'वाहन में: खुली जगह रुकें, सीटबेल्ट लगाकर अंदर रहें।'],
    ],
    after: [
      ['Expect aftershocks. Drop, cover, hold on again each time.', 'झटकों की आशंका रखें। हर बार फिर झुको, ढको, पकड़ो।'],
      ['Check yourself and others for injuries. Switch off gas and electricity if safe. If you smell gas, leave and do not use flames or switches.', 'ख़ुद और दूसरों में चोट देखें। सुरक्षित हो तो गैस और बिजली बंद करें। गैस की गंध हो तो बाहर निकलें, आग या स्विच न छुएँ।'],
      ['Leave damaged buildings. Do not re-enter until declared safe. Use Beacon "I am safe" to let family know.', 'क्षतिग्रस्त इमारत छोड़ दें। सुरक्षित घोषित होने तक वापस न जाएँ। परिवार को बताने के लिए Beacon "मैं सुरक्षित हूँ" इस्तेमाल करें।'],
      ['Near the coast, move to high ground at once after a strong or long quake in case of tsunami.', 'तट के पास तेज़ या लंबे भूकंप के बाद सुनामी की आशंका में तुरंत ऊँचाई पर जाएँ।'],
    ],
  },
  {
    id: 'flood',
    emoji: '🌊',
    title: ['Flood', 'बाढ़'],
    keywords: ['flood flooding water rising heavy rain waterlogging river overflow dam', 'बाढ़ पानी बढ़ना भारी बारिश जलभराव नदी बांध'],
    before: [
      ['Know the nearest high ground and shelter and two routes to it.', 'सबसे नज़दीकी ऊँची जगह, आश्रय और उसके दो रास्ते जानें।'],
      ['Keep documents, medicines, torch, power bank and water in a waterproof bag, on a high shelf.', 'दस्तावेज़, दवाइयाँ, टॉर्च, पावर बैंक और पानी वॉटरप्रूफ़ थैले में ऊँची शेल्फ़ पर रखें।'],
      ['Follow alerts. Move early when told to evacuate.', 'चेतावनियाँ मानें। निकलने को कहा जाए तो जल्दी निकलें।'],
    ],
    during: [
      ['Move to higher ground. Do not wait for the water to reach you.', 'ऊँची जगह जाएँ। पानी के आने का इंतज़ार न करें।'],
      ['Never walk, swim or drive through floodwater. 15 cm of moving water can knock you down.', 'बाढ़ के पानी में पैदल, तैरकर या गाड़ी से न जाएँ। 15 सेमी बहता पानी गिरा सकता है।'],
      ['Switch off electricity at the mains if safe. Stay away from poles, wires and anything in the water.', 'सुरक्षित हो तो मेन से बिजली बंद करें। खंभों, तारों और पानी में पड़ी चीज़ों से दूर रहें।'],
      ['If trapped, go to the highest floor or roof and signal for help. Do not climb into a closed attic.', 'फँस जाएँ तो सबसे ऊँची मंज़िल या छत पर जाकर मदद का संकेत दें। बंद टांड में न चढ़ें।'],
    ],
    after: [
      ['Return only when authorities say it is safe.', 'अधिकारियों के सुरक्षित बताने पर ही लौटें।'],
      ['Treat all floodwater and tap water as unsafe: boil or treat it. Throw away food that touched floodwater.', 'बाढ़ और नल के पानी को असुरक्षित मानें: उबालें या शुद्ध करें। बाढ़ के पानी से छुआ खाना फेंक दें।'],
      ['Watch for snakes, broken glass, weak floors. Wash cuts well and get a tetanus shot if due.', 'साँप, टूटे काँच, कमज़ोर फ़र्श से सावधान रहें। कट अच्छी तरह धोएँ और टेटनस का टीका बाक़ी हो तो लगवाएँ।'],
      ['Stay alert for diarrhoea, fever and skin infections. Use ORS early.', 'दस्त, बुखार और त्वचा संक्रमण पर नज़र रखें। ORS जल्दी दें।'],
    ],
  },
  {
    id: 'cyclone',
    emoji: '🌀',
    title: ['Cyclone or storm', 'चक्रवात या तूफ़ान'],
    keywords: ['cyclone storm hurricane typhoon strong wind storm surge coast gale', 'चक्रवात तूफ़ान आँधी तेज़ हवा तट समुद्री लहर'],
    before: [
      ['Follow IMD warnings. Move early if you live near the coast or in a weak house.', 'IMD की चेतावनियाँ मानें। तट के पास या कमज़ोर घर में रहते हैं तो जल्दी निकलें।'],
      ['Secure the roof and loose items, stock 3 days of water, dry food, medicines, charged power banks.', 'छत और ढीला सामान सुरक्षित करें, 3 दिन का पानी, सूखा खाना, दवाइयाँ और चार्ज पावर बैंक रखें।'],
      ['Know the nearest cyclone shelter.', 'सबसे नज़दीकी चक्रवात आश्रय जानें।'],
    ],
    during: [
      ['Stay indoors in a strong room away from windows. Lie under a sturdy table if the roof is damaged.', 'खिड़कियों से दूर मज़बूत कमरे में अंदर रहें। छत टूटे तो मज़बूत मेज़ के नीचे लेटें।'],
      ['The calm eye can feel like the end. The storm returns from the opposite side: stay inside.', 'तूफ़ान की आँख की शांति अंत जैसी लग सकती है। तूफ़ान उल्टी दिशा से लौटता है: अंदर रहें।'],
      ['Do not go out to watch or to the sea. Keep a radio or Beacon alerts on.', 'देखने या समुद्र पर न जाएँ। रेडियो या Beacon अलर्ट चालू रखें।'],
    ],
    after: [
      ['Stay away from fallen power lines and standing water.', 'गिरे बिजली के तारों और जमे पानी से दूर रहें।'],
      ['Check for injuries. Use only boiled or treated water.', 'चोटें जाँचें। केवल उबला या शुद्ध किया पानी इस्तेमाल करें।'],
      ['Return home only when officials say so. Report damage and needs on the Beacon resource board.', 'अधिकारियों के कहने पर ही घर लौटें। नुक़सान और ज़रूरतें Beacon संसाधन बोर्ड पर बताएँ।'],
    ],
  },
  {
    id: 'landslide',
    emoji: '⛰️',
    title: ['Landslide', 'भूस्खलन'],
    keywords: ['landslide mudslide rockfall hill slope debris flow cracks heavy rain mountain', 'भूस्खलन पहाड़ ढलान मलबा दरारें भारी बारिश चट्टान'],
    before: [
      ['In hill areas, watch for cracks in ground or walls, tilting trees, new springs, muddy water in streams.', 'पहाड़ी इलाक़ों में ज़मीन-दीवारों में दरारें, झुकते पेड़, नए झरने, नालों में मटमैला पानी देखें।'],
      ['Move away during very heavy rain if you live below a steep slope.', 'तेज़ ढलान के नीचे रहते हैं तो बहुत भारी बारिश में हट जाएँ।'],
    ],
    during: [
      ['If you hear a rumble or see debris moving, run sideways, out of the path, to high ground. Do not run downhill along the flow.', 'गड़गड़ाहट सुनें या मलबा खिसकता दिखे तो बहाव के रास्ते से बगल की ओर ऊँचाई पर भागें। बहाव के साथ नीचे न दौड़ें।'],
      ['If you cannot escape, curl into a tight ball and protect your head.', 'न बच सकें तो गेंद की तरह सिमटकर सिर बचाएँ।'],
    ],
    after: [
      ['Stay away from the slide area; more slides may follow.', 'भूस्खलन क्षेत्र से दूर रहें; और हो सकते हैं।'],
      ['Check for trapped people and call rescue teams; do not enter unstable debris. Watch for broken power and gas lines.', 'फँसे लोगों को देखें और बचाव दल बुलाएँ; अस्थिर मलबे में न जाएँ। टूटी बिजली और गैस लाइनों से सावधान।'],
    ],
  },
  {
    id: 'heatwave',
    emoji: '☀️',
    title: ['Heatwave', 'लू / हीटवेव'],
    keywords: ['heatwave heat wave hot summer temperature sun loo dehydration', 'लू हीटवेव गर्मी तापमान धूप'],
    before: [
      ['Prepare a cool room, keep ORS and water ready and check on elders and children.', 'ठंडा कमरा तैयार रखें, ORS और पानी रखें और बुज़ुर्गों व बच्चों का हाल लेते रहें।'],
    ],
    during: [
      ['Avoid going out between 12 and 4 pm. Cover your head, wear light cotton clothes.', 'दोपहर 12 से 4 बजे बाहर न जाएँ। सिर ढकें, हल्के सूती कपड़े पहनें।'],
      ['Drink water, buttermilk, ORS or lemon water often, even if not thirsty.', 'प्यास न लगे तो भी पानी, छाछ, ORS या नींबू पानी बार-बार पिएँ।'],
      ['Never leave children or pets in a parked vehicle.', 'बच्चों या पालतू जानवरों को खड़ी गाड़ी में कभी न छोड़ें।'],
      ['Know heat stroke signs: confusion, hot dry skin, fainting. Cool them and call 112.', 'लू के लक्षण जानें: भ्रम, गर्म सूखी त्वचा, बेहोशी। ठंडा करें और 112 पर कॉल करें।'],
    ],
    after: [['Keep drinking fluids and rest for a day or two.', 'एक-दो दिन तरल पीते रहें और आराम करें।']],
  },
  {
    id: 'lightning',
    emoji: '⛈️',
    title: ['Thunderstorm and lightning', 'आँधी-बिजली'],
    keywords: ['lightning thunder thunderstorm storm hail bijli', 'बिजली गरज आँधी तूफ़ान ओले आकाशीय'],
    before: [['Check the forecast. Plan to be indoors during thunderstorms.', 'पूर्वानुमान देखें। गरज के समय अंदर रहने की योजना बनाएँ।']],
    during: [
      ['Go into a solid building or a hard-topped vehicle. Stay away from windows, wired phones and plumbing.', 'पक्की इमारत या पक्की छत की गाड़ी में जाएँ। खिड़कियों, तार वाले फ़ोन और नल से दूर रहें।'],
      ['Outside with no shelter: keep away from trees, poles, water and open fields. Crouch low on the balls of your feet, feet together, head down. Do not lie flat.', 'बाहर बिना आश्रय: पेड़, खंभे, पानी और खुले खेत से दूर रहें। पंजों पर पैर सटाकर, सिर झुकाकर नीचे बैठें। लेटें नहीं।'],
      ['Wait 30 minutes after the last thunder before going out.', 'आख़िरी गरज के 30 मिनट बाद ही बाहर निकलें।'],
    ],
    after: [['Someone struck by lightning carries no charge. Call 112 and start CPR if they are not breathing.', 'बिजली गिरने से घायल व्यक्ति में करंट नहीं रहता। 112 पर कॉल करें और साँस न हो तो सीपीआर शुरू करें।']],
  },
  {
    id: 'tsunami',
    emoji: '🌊',
    title: ['Tsunami', 'सुनामी'],
    keywords: ['tsunami sea wave coast ocean earthquake sea receding', 'सुनामी समुद्र लहर तट भूकंप समुद्र पीछे हटना'],
    before: [['Know if you live in a coastal danger zone and the way to high ground (at least 30 m above sea or 3 km inland).', 'जानें कि आप तटीय ख़तरे वाले क्षेत्र में हैं या नहीं और ऊँचाई का रास्ता (समुद्र से कम से कम 30 मी ऊपर या 3 किमी अंदर)।']],
    during: [
      ['A strong or long earthquake near the coast, or the sea suddenly pulling back, is a natural warning: go up and inland immediately. Do not wait for an official alert.', 'तट के पास तेज़ या लंबा भूकंप, या समुद्र का अचानक पीछे हटना प्राकृतिक चेतावनी है: तुरंत ऊँचाई और अंदर की ओर जाएँ। सरकारी अलर्ट का इंतज़ार न करें।'],
      ['Walk or run if roads are jammed. Never go to the beach to watch.', 'सड़कें जाम हों तो पैदल या दौड़कर जाएँ। देखने के लिए समुद्र तट पर कभी न जाएँ।'],
    ],
    after: [['Waves can keep coming for hours. Stay on high ground until officials say it is safe.', 'लहरें घंटों आ सकती हैं। अधिकारियों के सुरक्षित बताने तक ऊँचाई पर रहें।']],
  },
];

export const GO_BAG: { id: string; item: T; group: T }[] = [
  { id: 'water', group: ['Water and food', 'पानी और खाना'], item: ['Water: 3 litres per person per day, for 3 days', 'पानी: प्रति व्यक्ति प्रतिदिन 3 लीटर, 3 दिन के लिए'] },
  { id: 'food', group: ['Water and food', 'पानी और खाना'], item: ['Dry food: chana, peanuts, biscuits, dates, energy bars', 'सूखा खाना: चना, मूँगफली, बिस्कुट, खजूर, एनर्जी बार'] },
  { id: 'ors', group: ['Water and food', 'पानी और खाना'], item: ['ORS packets and water purification tablets', 'ORS के पैकेट और पानी शुद्ध करने की गोलियाँ'] },
  { id: 'firstaid', group: ['Health', 'स्वास्थ्य'], item: ['First-aid kit: bandages, antiseptic, tape, scissors, gloves', 'प्राथमिक उपचार किट: पट्टी, एंटीसेप्टिक, टेप, कैंची, दस्ताने'] },
  { id: 'meds', group: ['Health', 'स्वास्थ्य'], item: ['A week of regular medicines, with a copy of prescriptions', 'नियमित दवाइयाँ एक हफ़्ते की, पर्चियों की कॉपी के साथ'] },
  { id: 'mask', group: ['Health', 'स्वास्थ्य'], item: ['N95 masks, sanitiser, soap, sanitary pads', 'N95 मास्क, सैनिटाइज़र, साबुन, सैनिटरी पैड'] },
  { id: 'docs', group: ['Documents and money', 'दस्तावेज़ और पैसे'], item: ['ID, medical ID card and insurance papers in a waterproof pouch (and photos on your phone)', 'पहचान पत्र, मेडिकल आईडी और बीमा के काग़ज़ वॉटरप्रूफ़ पाउच में (और फ़ोन में फ़ोटो)'] },
  { id: 'cash', group: ['Documents and money', 'दस्तावेज़ और पैसे'], item: ['Cash in small notes and a list of family phone numbers on paper', 'छोटे नोटों में नक़द और परिवार के फ़ोन नंबरों की काग़ज़ पर सूची'] },
  { id: 'torch', group: ['Tools', 'औज़ार'], item: ['Torch, spare batteries, power bank, whistle', 'टॉर्च, अतिरिक्त बैटरी, पावर बैंक, सीटी'] },
  { id: 'radio', group: ['Tools', 'औज़ार'], item: ['Battery or crank radio, multi-tool, rope, plastic sheet', 'बैटरी या हैंडल वाला रेडियो, मल्टी-टूल, रस्सी, प्लास्टिक शीट'] },
  { id: 'clothes', group: ['Comfort', 'आराम'], item: ['Spare clothes, sturdy shoes, blanket or shawl, raincoat', 'अतिरिक्त कपड़े, मज़बूत जूते, कंबल या शॉल, रेनकोट'] },
  { id: 'kids', group: ['Comfort', 'आराम'], item: ['For children: snacks, a small toy or book, a note with parents\' numbers', 'बच्चों के लिए: नाश्ता, छोटा खिलौना या किताब, माता-पिता के नंबर का पर्चा'] },
  { id: 'pets', group: ['Comfort', 'आराम'], item: ['For elders and pets: glasses, hearing aid batteries, food and a leash', 'बुज़ुर्गों और पालतू के लिए: चश्मा, सुनने की मशीन की बैटरी, खाना और पट्टा'] },
];
