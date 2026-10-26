// Place search for the "pick a place" box. Layers, best first:
//   1. OpenWeather Geocoding, only when an OpenWeather key is saved (key is never returned or logged).
//   2. Open-Meteo geocoding (no key).
//   3. The built-in list of Indian cities and towns (offline, or when both network layers fail or are empty).
// Results from the network layers are merged, de-duplicated by rounded coordinates, and ranked India first, then
// names that start with the query. searchPlaces never throws. Each network layer gets 4 seconds.

export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

export interface PlaceResult {
  name: string;
  /** State or union territory as a display name, e.g. "Chhattisgarh". Empty when unknown. */
  state: string;
  /** ISO country code where known, e.g. "IN". */
  country: string;
  lat: number;
  lon: number;
  /** "City, State, Country", e.g. "Raipur, Chhattisgarh, IN" (state left out when it repeats the name). */
  label: string;
}

export interface SearchOptions {
  /** Network timeout per layer in milliseconds. Default 4000. */
  timeoutMs?: number;
  /** The saved OpenWeather key. When present, OpenWeather Geocoding is used as the first layer. */
  owmKey?: string;
}

const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const OWM_URL = 'https://api.openweathermap.org/geo/1.0/direct';
const MIN_QUERY = 1; // the built-in list answers from one character
const MIN_NETWORK = 2; // network lookups need two characters
const MAX_QUERY = 80;
const LIMIT = 8;

/** Lower case with accents removed, so "Odísha" matches "odisha". */
export const fold = (s: string): string => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

const clean = (q: unknown) => String(q ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY);
/** The client may send "Raipur, Chh"; only the part before the first comma is the place name. */
const namepart = (q: string) => clean(q.split(',')[0]);

/** Built-in fallback list: Indian cities, towns and state capitals with their state and coordinates. */
export const BUILTIN_PLACES: ReadonlyArray<{ name: string; state: string; lat: number; lon: number }> = [
  // Chhattisgarh
  { name: 'Raipur', state: 'Chhattisgarh', lat: 21.2514, lon: 81.6296 },
  { name: 'Bhilai', state: 'Chhattisgarh', lat: 21.2094, lon: 81.3784 },
  { name: 'Durg', state: 'Chhattisgarh', lat: 21.1904, lon: 81.2849 },
  { name: 'Bilaspur', state: 'Chhattisgarh', lat: 22.0797, lon: 82.1409 },
  { name: 'Korba', state: 'Chhattisgarh', lat: 22.3595, lon: 82.7501 },
  { name: 'Rajnandgaon', state: 'Chhattisgarh', lat: 21.097, lon: 81.03 },
  { name: 'Raigarh', state: 'Chhattisgarh', lat: 21.8974, lon: 83.395 },
  { name: 'Jagdalpur', state: 'Chhattisgarh', lat: 19.0748, lon: 82.0217 },
  { name: 'Ambikapur', state: 'Chhattisgarh', lat: 23.1191, lon: 83.1953 },
  { name: 'Dhamtari', state: 'Chhattisgarh', lat: 20.7075, lon: 81.5494 },
  { name: 'Mahasamund', state: 'Chhattisgarh', lat: 21.1096, lon: 82.0969 },
  { name: 'Kanker', state: 'Chhattisgarh', lat: 20.2725, lon: 81.4899 },
  { name: 'Chirmiri', state: 'Chhattisgarh', lat: 23.205, lon: 82.329 },
  { name: 'Janjgir', state: 'Chhattisgarh', lat: 22.0135, lon: 82.5739 },
  // Delhi, Chandigarh and union territories
  { name: 'Delhi', state: 'Delhi', lat: 28.6139, lon: 77.209 },
  { name: 'Chandigarh', state: 'Chandigarh', lat: 30.7333, lon: 76.7794 },
  { name: 'Puducherry', state: 'Puducherry', lat: 11.9416, lon: 79.8083 },
  { name: 'Karaikal', state: 'Puducherry', lat: 10.9254, lon: 79.838 },
  { name: 'Daman', state: 'Daman and Diu', lat: 20.3974, lon: 72.8328 },
  { name: 'Silvassa', state: 'Dadra and Nagar Haveli', lat: 20.274, lon: 73.0169 },
  { name: 'Kavaratti', state: 'Lakshadweep', lat: 10.5669, lon: 72.642 },
  { name: 'Port Blair', state: 'Andaman and Nicobar', lat: 11.6234, lon: 92.7265 },
  // Maharashtra
  { name: 'Mumbai', state: 'Maharashtra', lat: 19.076, lon: 72.8777 },
  { name: 'Pune', state: 'Maharashtra', lat: 18.5204, lon: 73.8567 },
  { name: 'Nagpur', state: 'Maharashtra', lat: 21.1458, lon: 79.0882 },
  { name: 'Nashik', state: 'Maharashtra', lat: 19.9975, lon: 73.7898 },
  { name: 'Thane', state: 'Maharashtra', lat: 19.2183, lon: 72.9781 },
  { name: 'Navi Mumbai', state: 'Maharashtra', lat: 19.033, lon: 73.0297 },
  { name: 'Vasai-Virar', state: 'Maharashtra', lat: 19.4612, lon: 72.7989 },
  { name: 'Pimpri-Chinchwad', state: 'Maharashtra', lat: 18.6298, lon: 73.7997 },
  { name: 'Aurangabad', state: 'Maharashtra', lat: 19.8762, lon: 75.3433 },
  { name: 'Solapur', state: 'Maharashtra', lat: 17.6599, lon: 75.9064 },
  { name: 'Kolhapur', state: 'Maharashtra', lat: 16.705, lon: 74.2433 },
  { name: 'Amravati', state: 'Maharashtra', lat: 20.932, lon: 77.7523 },
  { name: 'Akola', state: 'Maharashtra', lat: 20.7002, lon: 77.0082 },
  { name: 'Latur', state: 'Maharashtra', lat: 18.4088, lon: 76.5604 },
  { name: 'Jalgaon', state: 'Maharashtra', lat: 21.0077, lon: 75.5626 },
  { name: 'Nanded', state: 'Maharashtra', lat: 19.1383, lon: 77.321 },
  { name: 'Ahmednagar', state: 'Maharashtra', lat: 19.0952, lon: 74.7496 },
  { name: 'Dhule', state: 'Maharashtra', lat: 20.9042, lon: 74.7749 },
  { name: 'Sangli', state: 'Maharashtra', lat: 16.8524, lon: 74.5815 },
  // West Bengal
  { name: 'Kolkata', state: 'West Bengal', lat: 22.5726, lon: 88.3639 },
  { name: 'Howrah', state: 'West Bengal', lat: 22.5958, lon: 88.2636 },
  { name: 'Siliguri', state: 'West Bengal', lat: 26.7271, lon: 88.6393 },
  { name: 'Durgapur', state: 'West Bengal', lat: 23.5204, lon: 87.3119 },
  { name: 'Asansol', state: 'West Bengal', lat: 23.6739, lon: 86.9524 },
  { name: 'Bardhaman', state: 'West Bengal', lat: 23.2324, lon: 87.8615 },
  { name: 'Malda', state: 'West Bengal', lat: 25.0108, lon: 88.1411 },
  { name: 'Kharagpur', state: 'West Bengal', lat: 22.346, lon: 87.232 },
  { name: 'Haldia', state: 'West Bengal', lat: 22.0667, lon: 88.0698 },
  { name: 'Darjeeling', state: 'West Bengal', lat: 27.041, lon: 88.2663 },
  { name: 'Jalpaiguri', state: 'West Bengal', lat: 26.5167, lon: 88.7333 },
  // Tamil Nadu
  { name: 'Chennai', state: 'Tamil Nadu', lat: 13.0827, lon: 80.2707 },
  { name: 'Coimbatore', state: 'Tamil Nadu', lat: 11.0168, lon: 76.9558 },
  { name: 'Madurai', state: 'Tamil Nadu', lat: 9.9252, lon: 78.1198 },
  { name: 'Tiruchirappalli', state: 'Tamil Nadu', lat: 10.7905, lon: 78.7047 },
  { name: 'Salem', state: 'Tamil Nadu', lat: 11.6643, lon: 78.146 },
  { name: 'Tirunelveli', state: 'Tamil Nadu', lat: 8.7139, lon: 77.7567 },
  { name: 'Vellore', state: 'Tamil Nadu', lat: 12.9165, lon: 79.1325 },
  { name: 'Erode', state: 'Tamil Nadu', lat: 11.341, lon: 77.7172 },
  { name: 'Thoothukudi', state: 'Tamil Nadu', lat: 8.7642, lon: 78.1348 },
  { name: 'Tiruppur', state: 'Tamil Nadu', lat: 11.1085, lon: 77.3411 },
  { name: 'Hosur', state: 'Tamil Nadu', lat: 12.7409, lon: 77.8253 },
  { name: 'Thanjavur', state: 'Tamil Nadu', lat: 10.787, lon: 79.1378 },
  // Karnataka
  { name: 'Bengaluru', state: 'Karnataka', lat: 12.9716, lon: 77.5946 },
  { name: 'Mysuru', state: 'Karnataka', lat: 12.2958, lon: 76.6394 },
  { name: 'Mangaluru', state: 'Karnataka', lat: 12.9141, lon: 74.856 },
  { name: 'Hubballi', state: 'Karnataka', lat: 15.3647, lon: 75.124 },
  { name: 'Belagavi', state: 'Karnataka', lat: 15.8497, lon: 74.4977 },
  { name: 'Davangere', state: 'Karnataka', lat: 14.4644, lon: 75.9218 },
  { name: 'Ballari', state: 'Karnataka', lat: 15.1394, lon: 76.9214 },
  { name: 'Shivamogga', state: 'Karnataka', lat: 13.9299, lon: 75.5681 },
  { name: 'Kalaburagi', state: 'Karnataka', lat: 17.3297, lon: 76.8343 },
  // Telangana and Andhra Pradesh
  { name: 'Hyderabad', state: 'Telangana', lat: 17.385, lon: 78.4867 },
  { name: 'Warangal', state: 'Telangana', lat: 17.9689, lon: 79.5941 },
  { name: 'Nizamabad', state: 'Telangana', lat: 18.6725, lon: 78.0941 },
  { name: 'Karimnagar', state: 'Telangana', lat: 18.4386, lon: 79.1288 },
  { name: 'Khammam', state: 'Telangana', lat: 17.2473, lon: 80.1514 },
  { name: 'Visakhapatnam', state: 'Andhra Pradesh', lat: 17.6868, lon: 83.2185 },
  { name: 'Vijayawada', state: 'Andhra Pradesh', lat: 16.5062, lon: 80.648 },
  { name: 'Amaravati', state: 'Andhra Pradesh', lat: 16.5417, lon: 80.515 },
  { name: 'Guntur', state: 'Andhra Pradesh', lat: 16.3067, lon: 80.4365 },
  { name: 'Nellore', state: 'Andhra Pradesh', lat: 14.4426, lon: 79.9865 },
  { name: 'Kurnool', state: 'Andhra Pradesh', lat: 15.8281, lon: 78.0373 },
  { name: 'Tirupati', state: 'Andhra Pradesh', lat: 13.6288, lon: 79.4192 },
  { name: 'Rajahmundry', state: 'Andhra Pradesh', lat: 17.0005, lon: 81.804 },
  { name: 'Kakinada', state: 'Andhra Pradesh', lat: 16.9891, lon: 82.2475 },
  { name: 'Anantapur', state: 'Andhra Pradesh', lat: 14.6819, lon: 77.6006 },
  // Gujarat
  { name: 'Ahmedabad', state: 'Gujarat', lat: 23.0225, lon: 72.5714 },
  { name: 'Gandhinagar', state: 'Gujarat', lat: 23.2156, lon: 72.6369 },
  { name: 'Surat', state: 'Gujarat', lat: 21.1702, lon: 72.8311 },
  { name: 'Vadodara', state: 'Gujarat', lat: 22.3072, lon: 73.1812 },
  { name: 'Rajkot', state: 'Gujarat', lat: 22.3039, lon: 70.8022 },
  { name: 'Bhavnagar', state: 'Gujarat', lat: 21.7645, lon: 72.1519 },
  { name: 'Jamnagar', state: 'Gujarat', lat: 22.4707, lon: 70.0577 },
  { name: 'Junagadh', state: 'Gujarat', lat: 21.5222, lon: 70.4579 },
  { name: 'Anand', state: 'Gujarat', lat: 22.5645, lon: 72.9289 },
  { name: 'Morbi', state: 'Gujarat', lat: 22.8173, lon: 70.8377 },
  { name: 'Bharuch', state: 'Gujarat', lat: 21.7051, lon: 72.9959 },
  { name: 'Vapi', state: 'Gujarat', lat: 20.3893, lon: 72.9106 },
  { name: 'Gandhidham', state: 'Gujarat', lat: 23.0753, lon: 70.1337 },
  { name: 'Porbandar', state: 'Gujarat', lat: 21.6417, lon: 69.6293 },
  { name: 'Mehsana', state: 'Gujarat', lat: 23.588, lon: 72.3693 },
  { name: 'Navsari', state: 'Gujarat', lat: 20.9467, lon: 72.952 },
  // Madhya Pradesh
  { name: 'Bhopal', state: 'Madhya Pradesh', lat: 23.2599, lon: 77.4126 },
  { name: 'Indore', state: 'Madhya Pradesh', lat: 22.7196, lon: 75.8577 },
  { name: 'Jabalpur', state: 'Madhya Pradesh', lat: 23.1815, lon: 79.9864 },
  { name: 'Gwalior', state: 'Madhya Pradesh', lat: 26.2183, lon: 78.1828 },
  { name: 'Ujjain', state: 'Madhya Pradesh', lat: 23.1765, lon: 75.7885 },
  { name: 'Sagar', state: 'Madhya Pradesh', lat: 23.8388, lon: 78.7378 },
  { name: 'Satna', state: 'Madhya Pradesh', lat: 24.5854, lon: 80.8322 },
  { name: 'Rewa', state: 'Madhya Pradesh', lat: 24.5373, lon: 81.3042 },
  { name: 'Ratlam', state: 'Madhya Pradesh', lat: 23.3315, lon: 75.0367 },
  { name: 'Dewas', state: 'Madhya Pradesh', lat: 22.9676, lon: 76.0534 },
  { name: 'Chhindwara', state: 'Madhya Pradesh', lat: 22.0574, lon: 78.9382 },
  { name: 'Khandwa', state: 'Madhya Pradesh', lat: 21.827, lon: 76.352 },
  { name: 'Burhanpur', state: 'Madhya Pradesh', lat: 21.3009, lon: 76.23 },
  // Kerala
  { name: 'Thiruvananthapuram', state: 'Kerala', lat: 8.5241, lon: 76.9366 },
  { name: 'Kochi', state: 'Kerala', lat: 9.9312, lon: 76.2673 },
  { name: 'Kozhikode', state: 'Kerala', lat: 11.2588, lon: 75.7804 },
  { name: 'Kollam', state: 'Kerala', lat: 8.8932, lon: 76.6141 },
  { name: 'Thrissur', state: 'Kerala', lat: 10.5276, lon: 76.2144 },
  { name: 'Kannur', state: 'Kerala', lat: 11.8745, lon: 75.3704 },
  { name: 'Alappuzha', state: 'Kerala', lat: 9.4981, lon: 76.3388 },
  { name: 'Malappuram', state: 'Kerala', lat: 11.051, lon: 76.0711 },
  { name: 'Kottayam', state: 'Kerala', lat: 9.5916, lon: 76.5222 },
  { name: 'Palakkad', state: 'Kerala', lat: 10.7867, lon: 76.6548 },
  // Rajasthan
  { name: 'Jaipur', state: 'Rajasthan', lat: 26.9124, lon: 75.7873 },
  { name: 'Udaipur', state: 'Rajasthan', lat: 24.5854, lon: 73.7125 },
  { name: 'Jodhpur', state: 'Rajasthan', lat: 26.2389, lon: 73.0243 },
  { name: 'Kota', state: 'Rajasthan', lat: 25.2138, lon: 75.8648 },
  { name: 'Bikaner', state: 'Rajasthan', lat: 28.0229, lon: 73.3119 },
  { name: 'Ajmer', state: 'Rajasthan', lat: 26.4499, lon: 74.6399 },
  { name: 'Bhilwara', state: 'Rajasthan', lat: 25.3407, lon: 74.6313 },
  { name: 'Alwar', state: 'Rajasthan', lat: 27.553, lon: 76.6346 },
  { name: 'Sikar', state: 'Rajasthan', lat: 27.6094, lon: 75.1399 },
  { name: 'Bharatpur', state: 'Rajasthan', lat: 27.2152, lon: 77.49 },
  // Uttar Pradesh
  { name: 'Lucknow', state: 'Uttar Pradesh', lat: 26.8467, lon: 80.9462 },
  { name: 'Kanpur', state: 'Uttar Pradesh', lat: 26.4499, lon: 80.3319 },
  { name: 'Varanasi', state: 'Uttar Pradesh', lat: 25.3176, lon: 82.9739 },
  { name: 'Agra', state: 'Uttar Pradesh', lat: 27.1767, lon: 78.0081 },
  { name: 'Meerut', state: 'Uttar Pradesh', lat: 28.9845, lon: 77.7064 },
  { name: 'Ghaziabad', state: 'Uttar Pradesh', lat: 28.6692, lon: 77.4538 },
  { name: 'Noida', state: 'Uttar Pradesh', lat: 28.5355, lon: 77.391 },
  { name: 'Prayagraj', state: 'Uttar Pradesh', lat: 25.4358, lon: 81.8463 },
  { name: 'Bareilly', state: 'Uttar Pradesh', lat: 28.367, lon: 79.4304 },
  { name: 'Aligarh', state: 'Uttar Pradesh', lat: 27.8974, lon: 78.088 },
  { name: 'Moradabad', state: 'Uttar Pradesh', lat: 28.8386, lon: 78.7733 },
  { name: 'Gorakhpur', state: 'Uttar Pradesh', lat: 26.7606, lon: 83.3732 },
  { name: 'Mathura', state: 'Uttar Pradesh', lat: 27.4924, lon: 77.6737 },
  { name: 'Saharanpur', state: 'Uttar Pradesh', lat: 29.968, lon: 77.551 },
  { name: 'Jhansi', state: 'Uttar Pradesh', lat: 25.4484, lon: 78.5685 },
  { name: 'Ayodhya', state: 'Uttar Pradesh', lat: 26.7922, lon: 82.1998 },
  // Bihar
  { name: 'Patna', state: 'Bihar', lat: 25.5941, lon: 85.1376 },
  { name: 'Gaya', state: 'Bihar', lat: 24.7955, lon: 85.0002 },
  { name: 'Bhagalpur', state: 'Bihar', lat: 25.2425, lon: 86.9842 },
  { name: 'Muzaffarpur', state: 'Bihar', lat: 26.1209, lon: 85.3647 },
  { name: 'Darbhanga', state: 'Bihar', lat: 26.1542, lon: 85.8918 },
  { name: 'Purnia', state: 'Bihar', lat: 25.7771, lon: 87.4753 },
  { name: 'Bihar Sharif', state: 'Bihar', lat: 25.1982, lon: 85.521 },
  // Jharkhand
  { name: 'Ranchi', state: 'Jharkhand', lat: 23.3441, lon: 85.3096 },
  { name: 'Jamshedpur', state: 'Jharkhand', lat: 22.8046, lon: 86.2029 },
  { name: 'Dhanbad', state: 'Jharkhand', lat: 23.7957, lon: 86.4304 },
  { name: 'Bokaro', state: 'Jharkhand', lat: 23.6693, lon: 86.1511 },
  { name: 'Hazaribagh', state: 'Jharkhand', lat: 23.9966, lon: 85.3637 },
  { name: 'Deoghar', state: 'Jharkhand', lat: 24.4764, lon: 86.6948 },
  // Odisha
  { name: 'Bhubaneswar', state: 'Odisha', lat: 20.2961, lon: 85.8245 },
  { name: 'Cuttack', state: 'Odisha', lat: 20.4625, lon: 85.883 },
  { name: 'Rourkela', state: 'Odisha', lat: 22.2604, lon: 84.8536 },
  { name: 'Berhampur', state: 'Odisha', lat: 19.3149, lon: 84.7941 },
  { name: 'Sambalpur', state: 'Odisha', lat: 21.4669, lon: 83.9812 },
  { name: 'Puri', state: 'Odisha', lat: 19.8135, lon: 85.8312 },
  // North East
  { name: 'Guwahati', state: 'Assam', lat: 26.1445, lon: 91.7362 },
  { name: 'Dispur', state: 'Assam', lat: 26.1433, lon: 91.7898 },
  { name: 'Silchar', state: 'Assam', lat: 24.8333, lon: 92.7789 },
  { name: 'Dibrugarh', state: 'Assam', lat: 27.4728, lon: 94.912 },
  { name: 'Jorhat', state: 'Assam', lat: 26.7509, lon: 94.2037 },
  { name: 'Tezpur', state: 'Assam', lat: 26.6528, lon: 92.7926 },
  { name: 'Shillong', state: 'Meghalaya', lat: 25.5788, lon: 91.8933 },
  { name: 'Tura', state: 'Meghalaya', lat: 25.5141, lon: 90.2026 },
  { name: 'Imphal', state: 'Manipur', lat: 24.817, lon: 93.9368 },
  { name: 'Aizawl', state: 'Mizoram', lat: 23.7271, lon: 92.7176 },
  { name: 'Kohima', state: 'Nagaland', lat: 25.6751, lon: 94.1086 },
  { name: 'Dimapur', state: 'Nagaland', lat: 25.9091, lon: 93.7266 },
  { name: 'Itanagar', state: 'Arunachal Pradesh', lat: 27.0844, lon: 93.6053 },
  { name: 'Gangtok', state: 'Sikkim', lat: 27.3389, lon: 88.6065 },
  { name: 'Agartala', state: 'Tripura', lat: 23.8315, lon: 91.2868 },
  // North
  { name: 'Shimla', state: 'Himachal Pradesh', lat: 31.1048, lon: 77.1734 },
  { name: 'Dharamshala', state: 'Himachal Pradesh', lat: 32.219, lon: 76.3234 },
  { name: 'Mandi', state: 'Himachal Pradesh', lat: 31.7088, lon: 76.9318 },
  { name: 'Dehradun', state: 'Uttarakhand', lat: 30.3165, lon: 78.0322 },
  { name: 'Haridwar', state: 'Uttarakhand', lat: 29.9457, lon: 78.1642 },
  { name: 'Haldwani', state: 'Uttarakhand', lat: 29.2183, lon: 79.513 },
  { name: 'Roorkee', state: 'Uttarakhand', lat: 29.8543, lon: 77.888 },
  { name: 'Nainital', state: 'Uttarakhand', lat: 29.3803, lon: 79.4636 },
  { name: 'Amritsar', state: 'Punjab', lat: 31.634, lon: 74.8723 },
  { name: 'Ludhiana', state: 'Punjab', lat: 30.901, lon: 75.8573 },
  { name: 'Jalandhar', state: 'Punjab', lat: 31.326, lon: 75.5762 },
  { name: 'Patiala', state: 'Punjab', lat: 30.3398, lon: 76.3869 },
  { name: 'Bathinda', state: 'Punjab', lat: 30.211, lon: 74.9455 },
  { name: 'Faridabad', state: 'Haryana', lat: 28.4089, lon: 77.3178 },
  { name: 'Gurugram', state: 'Haryana', lat: 28.4595, lon: 77.0266 },
  { name: 'Panipat', state: 'Haryana', lat: 29.3909, lon: 76.9635 },
  { name: 'Ambala', state: 'Haryana', lat: 30.3782, lon: 76.7767 },
  { name: 'Karnal', state: 'Haryana', lat: 29.6857, lon: 76.9905 },
  { name: 'Hisar', state: 'Haryana', lat: 29.1492, lon: 75.7217 },
  { name: 'Rohtak', state: 'Haryana', lat: 28.8955, lon: 76.6066 },
  { name: 'Sonipat', state: 'Haryana', lat: 28.9931, lon: 77.0151 },
  { name: 'Panchkula', state: 'Haryana', lat: 30.6942, lon: 76.8606 },
  { name: 'Srinagar', state: 'Jammu and Kashmir', lat: 34.0837, lon: 74.7973 },
  { name: 'Jammu', state: 'Jammu and Kashmir', lat: 32.7266, lon: 74.857 },
  { name: 'Baramulla', state: 'Jammu and Kashmir', lat: 34.209, lon: 74.343 },
  { name: 'Leh', state: 'Ladakh', lat: 34.1526, lon: 77.5771 },
  // West
  { name: 'Panaji', state: 'Goa', lat: 15.4909, lon: 73.8278 },
  { name: 'Margao', state: 'Goa', lat: 15.2832, lon: 73.9862 },
  { name: 'Vasco da Gama', state: 'Goa', lat: 15.3982, lon: 73.8113 },
];

/** Labels are "City, State, Country" with the state left out when it repeats the city name. */
export function placeLabel(name: string, state: string, country: string): string {
  const parts = [name];
  if (state && fold(state) !== fold(name)) parts.push(state);
  if (country) parts.push(country);
  return parts.join(', ');
}

const isIndia = (p: { country: string }) => ['IN', 'INDIA'].includes(p.country.toUpperCase());

const builtinPlaces = (): PlaceResult[] =>
  BUILTIN_PLACES.map((p) => ({ name: p.name, state: p.state, country: 'IN', lat: p.lat, lon: p.lon, label: placeLabel(p.name, p.state, 'IN') }));

/**
 * Built-in matches for a query of one character or more. Names starting with the query come first, then names or
 * states containing it. Case and accents are ignored. At most 8 places.
 */
export function offlinePlaces(query: string): PlaceResult[] {
  const q = fold(namepart(clean(query)));
  if (!q) return [];
  const all = builtinPlaces();
  const starts = all.filter((p) => fold(p.name).startsWith(q));
  const rest = all.filter((p) => !starts.includes(p) && (fold(p.name).includes(q) || fold(p.state).includes(q)));
  return [...starts, ...rest].slice(0, LIMIT);
}

const validCoord = (n: unknown, max: number) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= max;

/** True when the place is usable and does not carry the key in any field that is returned. */
function usable(name: string, state: string, country: string, lat: unknown, lon: unknown, key: string): boolean {
  if (!name || !validCoord(lat, 90) || !validCoord(lon, 180)) return false;
  if (key && [name, state, country].some((s) => s.includes(key))) return false;
  return true;
}

/** Reads Open-Meteo's JSON. Entries without a usable name or coordinates are skipped. */
function parseOpenMeteo(data: unknown): PlaceResult[] {
  const rows = (data as { results?: unknown } | null)?.results;
  if (!Array.isArray(rows)) return [];
  const out: PlaceResult[] = [];
  for (const r of rows as Array<Record<string, unknown>>) {
    const name = typeof r?.name === 'string' ? r.name.trim() : '';
    const state = typeof r?.admin1 === 'string' ? r.admin1.trim() : '';
    const code = typeof r?.country_code === 'string' ? r.country_code.trim() : '';
    const country = code || (typeof r?.country === 'string' ? r.country.trim() : '');
    if (!usable(name, state, country, r?.latitude, r?.longitude, '')) continue;
    out.push({ name, state, country, lat: r.latitude as number, lon: r.longitude as number, label: placeLabel(name, state, country) });
  }
  return out;
}

/** Reads OpenWeather's Geocoding JSON (an array). The key is never copied into a result. */
function parseOwm(data: unknown, key: string): PlaceResult[] {
  if (!Array.isArray(data)) return [];
  const out: PlaceResult[] = [];
  for (const r of data as Array<Record<string, unknown>>) {
    const name = typeof r?.name === 'string' ? r.name.trim() : '';
    const state = typeof r?.state === 'string' ? r.state.trim() : '';
    const country = typeof r?.country === 'string' ? r.country.trim() : '';
    if (!usable(name, state, country, r?.lat, r?.lon, key)) continue;
    out.push({ name, state, country, lat: r.lat as number, lon: r.lon as number, label: placeLabel(name, state, country) });
  }
  return out;
}

/** Merge order: OpenWeather, then Open-Meteo. Duplicates (same coordinates to 0.1 degree) keep the first. India first, then prefix matches. */
function mergeAndRank(list: PlaceResult[], query: string): PlaceResult[] {
  const seen = new Set<string>();
  const unique: PlaceResult[] = [];
  for (const p of list) {
    const k = p.lat.toFixed(1) + ',' + p.lon.toFixed(1);
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(p);
  }
  const q = fold(namepart(query));
  const rank = (p: PlaceResult) => (isIndia(p) ? 0 : 2) + (fold(p.name).startsWith(q) ? 0 : 1);
  return unique.map((p, i) => ({ p, i })).sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i).map((x) => x.p).slice(0, LIMIT);
}

/** Runs one network layer with a time limit. Any failure, timeout or bad answer gives null (never a throw). */
async function timed(run: (signal: AbortSignal) => Promise<PlaceResult[] | null>, ms: number): Promise<PlaceResult[] | null> {
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<null>((resolve) => { timer = setTimeout(() => { ctrl.abort(); resolve(null); }, ms); });
  try {
    return await Promise.race([Promise.resolve().then(() => run(ctrl.signal)).catch(() => null), limit]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Suggestions for a place name. Returns at most 8 places, or [] for an empty query.
 * fetchFn defaults to the platform fetch. offline skips the network and uses the built-in list.
 */
export async function searchPlaces(query: string, fetchFn?: FetchLike, offline = false, opts: SearchOptions = {}): Promise<PlaceResult[]> {
  try {
    const q = namepart(clean(query));
    if (!fold(q)) return [];
    if (offline || fold(q).length < MIN_NETWORK) return offlinePlaces(q);
    const doFetch: FetchLike | undefined = fetchFn ?? (typeof fetch === 'function' ? (u, i) => fetch(u, i) : undefined);
    if (!doFetch) return offlinePlaces(q);
    const ms = opts.timeoutMs ?? 4000;
    const key = (opts.owmKey ?? '').trim();

    const owm = key
      ? timed(async (signal) => {
          const r = await doFetch(`${OWM_URL}?q=${encodeURIComponent(q)}&limit=${LIMIT}&appid=${encodeURIComponent(key)}`, { signal });
          if (!r || !r.ok) return null;
          return parseOwm(await r.json(), key);
        }, ms)
      : Promise.resolve(null);

    const om = timed(async (signal) => {
      const r = await doFetch(`${GEO_URL}?name=${encodeURIComponent(q)}&count=${LIMIT}&language=en&format=json`, { signal });
      if (!r || !r.ok) return null;
      return parseOpenMeteo(await r.json());
    }, ms);

    const [a, b] = await Promise.all([owm, om]);
    const merged = [...(a ?? []), ...(b ?? [])];
    if (!merged.length) return offlinePlaces(q);
    return mergeAndRank(merged, q);
  } catch {
    return offlinePlaces(query);
  }
}
