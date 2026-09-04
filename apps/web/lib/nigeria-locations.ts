export type NigeriaStateLocations = {
  state: string;
  locations: readonly string[];
};

// Nationwide service-market coverage. Every Nigerian state and the FCT is
// represented, with its capital and established service hubs available as
// selectable locations. Keep this as the single UI source until geography is
// moved to the configurable marketplace data model.
export const NIGERIA_STATE_LOCATIONS: readonly NigeriaStateLocations[] = [
  { state: 'Abia', locations: ['Aba', 'Arochukwu', 'Ohafia', 'Umuahia'] },
  { state: 'Adamawa', locations: ['Ganye', 'Jimeta', 'Mubi', 'Numan', 'Yola'] },
  { state: 'Akwa Ibom', locations: ['Eket', 'Ikot Abasi', 'Ikot Ekpene', 'Oron', 'Uyo'] },
  { state: 'Anambra', locations: ['Awka', 'Ekwulobia', 'Nnewi', 'Onitsha'] },
  { state: 'Bauchi', locations: ['Azare', 'Bauchi', 'Misau', 'Ningi'] },
  { state: 'Bayelsa', locations: ['Brass', 'Ogbia', 'Sagbama', 'Yenagoa'] },
  { state: 'Benue', locations: ['Gboko', 'Katsina-Ala', 'Makurdi', 'Otukpo'] },
  { state: 'Borno', locations: ['Bama', 'Biu', 'Maiduguri', 'Monguno'] },
  { state: 'Cross River', locations: ['Calabar', 'Ikom', 'Obudu', 'Ogoja'] },
  { state: 'Delta', locations: ['Agbor', 'Asaba', 'Sapele', 'Ughelli', 'Warri'] },
  { state: 'Ebonyi', locations: ['Abakaliki', 'Afikpo', 'Onueke', 'Uburu'] },
  { state: 'Edo', locations: ['Auchi', 'Benin City', 'Ekpoma', 'Uromi'] },
  { state: 'Ekiti', locations: ['Ado Ekiti', 'Ikere Ekiti', 'Ikole Ekiti', 'Oye Ekiti'] },
  { state: 'Enugu', locations: ['Enugu', 'Nsukka', 'Oji River', 'Udi'] },
  { state: 'Federal Capital Territory', locations: ['Abaji', 'Abuja', 'Bwari', 'Gwagwalada', 'Kuje', 'Kwali', 'Maitama', 'Wuse'] },
  { state: 'Gombe', locations: ['Bajoga', 'Billiri', 'Gombe', 'Kaltungo'] },
  { state: 'Imo', locations: ['Mbaise', 'Okigwe', 'Orlu', 'Owerri'] },
  { state: 'Jigawa', locations: ['Birnin Kudu', 'Dutse', 'Gumel', 'Hadejia'] },
  { state: 'Kaduna', locations: ['Kafanchan', 'Kaduna', 'Kagoro', 'Zaria'] },
  { state: 'Kano', locations: ['Bichi', 'Kano', 'Rano', 'Wudil'] },
  { state: 'Katsina', locations: ['Daura', 'Funtua', 'Kankia', 'Katsina'] },
  { state: 'Kebbi', locations: ['Argungu', 'Birnin Kebbi', 'Jega', 'Yauri'] },
  { state: 'Kogi', locations: ['Idah', 'Kabba', 'Lokoja', 'Okene'] },
  { state: 'Kwara', locations: ['Ilorin', 'Jebba', 'Offa', 'Omu-Aran'] },
  { state: 'Lagos', locations: ['Agege', 'Ajah', 'Alimosho', 'Badagry', 'Epe', 'Festac', 'Ikorodu', 'Ikeja', 'Lekki', 'Lagos Island', 'Maryland', 'Mushin', 'Ojota', 'Oshodi', 'Somolu', 'Surulere', 'Victoria Island', 'Yaba'] },
  { state: 'Nasarawa', locations: ['Akwanga', 'Karu', 'Keffi', 'Lafia', 'Mararaba'] },
  { state: 'Niger', locations: ['Bida', 'Kontagora', 'Minna', 'Suleja'] },
  { state: 'Ogun', locations: ['Abeokuta', 'Ifo', 'Ijebu Ode', 'Ota', 'Sagamu'] },
  { state: 'Ondo', locations: ['Akure', 'Ikare Akoko', 'Ondo City', 'Owo'] },
  { state: 'Osun', locations: ['Ede', 'Ife', 'Ilesa', 'Osogbo'] },
  { state: 'Oyo', locations: ['Eruwa', 'Ibadan', 'Iseyin', 'Ogbomoso', 'Oyo'] },
  { state: 'Plateau', locations: ['Barkin Ladi', 'Jos', 'Pankshin', 'Shendam'] },
  { state: 'Rivers', locations: ['Bonny', 'Eleme', 'Omoku', 'Port Harcourt'] },
  { state: 'Sokoto', locations: ['Gwadabawa', 'Sokoto', 'Tambuwal', 'Wurno'] },
  { state: 'Taraba', locations: ['Bali', 'Jalingo', 'Takum', 'Wukari'] },
  { state: 'Yobe', locations: ['Damaturu', 'Gashua', 'Geidam', 'Potiskum'] },
  { state: 'Zamfara', locations: ['Gusau', 'Kaura Namoda', 'Talata Mafara', 'Tsafe'] },
] as const;

export function locationSlug(location: string) {
  return location
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export function stateForLocation(value: string) {
  return NIGERIA_STATE_LOCATIONS.find(({ locations }) => locations.some((location) => locationSlug(location) === value))?.state;
}
