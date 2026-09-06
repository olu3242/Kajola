export type ServiceCategory = {
  id: string;
  label: string;
  group: 'Beauty & Grooming' | 'Health & Wellness' | 'Home & Lifestyle' | 'Professional Services' | 'Other';
  icon: string;
  aliases: readonly string[];
  featured: boolean;
  active: boolean;
  sortOrder: number;
};

export type NormalizedService = {
  id: string;
  label: string;
  categoryId: string;
  parent?: string;
  aliases: readonly string[];
  popular: boolean;
  active: boolean;
};

const category = (
  id: string,
  label: string,
  group: ServiceCategory['group'],
  icon: string,
  aliases: readonly string[],
  featured: boolean,
  sortOrder: number,
): ServiceCategory => ({ id, label, group, icon, aliases, featured, active: true, sortOrder });

export const SERVICE_CATEGORIES: readonly ServiceCategory[] = [
  category('hair', 'Hair', 'Beauty & Grooming', '✂', ['salon', 'stylist', 'beauty', 'natural hair'], true, 1),
  category('barber', 'Barber', 'Beauty & Grooming', '◩', ['barbershop', 'grooming', 'fade'], true, 2),
  category('nails', 'Nails', 'Beauty & Grooming', '◇', ['manicure', 'pedicure', 'nail salon'], true, 3),
  category('skin-care', 'Skin care', 'Beauty & Grooming', '◉', ['facial', 'skincare', 'esthetician'], true, 4),
  category('brows-lashes', 'Brows and lashes', 'Beauty & Grooming', '⌁', ['brows', 'lashes', 'eyelash'], true, 5),
  category('massage', 'Massage', 'Health & Wellness', '≈', ['therapy', 'body massage'], true, 6),
  category('makeup', 'Makeup', 'Beauty & Grooming', '✦', ['makeup artist', 'glam'], true, 7),
  category('wellness-spa', 'Wellness and spa', 'Health & Wellness', '☼', ['spa', 'wellness'], true, 8),
  category('braids-locs', 'Braids and locs', 'Beauty & Grooming', '〰', ['braids', 'dreadlocks', 'locs'], false, 9),
  category('hair-removal', 'Hair removal', 'Beauty & Grooming', '◌', ['waxing', 'laser'], false, 10),
  category('tattoos', 'Tattoos', 'Beauty & Grooming', '◆', ['tattoo artist', 'ink'], false, 11),
  category('piercing', 'Piercing', 'Beauty & Grooming', '○', ['body piercing'], false, 12),
  category('medical-aesthetics', 'Medical aesthetics', 'Health & Wellness', '✚', ['aesthetics', 'cosmetic clinic'], false, 13),
  category('dental-orthodontics', 'Dental and orthodontics', 'Health & Wellness', '□', ['dentist', 'dental', 'orthodontist'], false, 14),
  category('health-fitness', 'Health and fitness', 'Health & Wellness', '↗', ['fitness', 'gym', 'trainer', 'physiotherapy'], false, 15),
  category('home-services', 'Home services', 'Home & Lifestyle', '⌂', ['plumbing', 'electrical', 'handyman'], false, 16),
  category('pet-services', 'Pet services', 'Home & Lifestyle', '♧', ['pet care', 'grooming', 'veterinary'], false, 17),
  category('automotive', 'Automotive', 'Home & Lifestyle', '◈', ['mechanic', 'car repair', 'detailing'], false, 18),
  category('fashion-tailoring', 'Fashion and tailoring', 'Home & Lifestyle', '△', ['tailor', 'fashion', 'alterations'], false, 19),
  category('events-creative', 'Events and creative', 'Home & Lifestyle', '☆', ['photography', 'events', 'catering'], false, 20),
  category('cleaning', 'Cleaning', 'Home & Lifestyle', '✧', ['housekeeping', 'cleaner'], false, 21),
  category('repairs', 'Repairs', 'Home & Lifestyle', '◇', ['repair', 'installation', 'technician'], false, 22),
  category('professional-services', 'Professional services', 'Professional Services', '▦', ['consulting', 'legal', 'accounting', 'IT'], false, 23),
  category('personal-services', 'Personal services', 'Professional Services', '◎', ['coaching', 'tutoring', 'concierge'], false, 24),
  category('other', 'Other', 'Other', '+', ['custom', 'something else'], false, 99),
] as const;

const service = (id: string, label: string, categoryId: string, parent: string, aliases: readonly string[] = []): NormalizedService => ({
  id, label, categoryId, parent, aliases, popular: true, active: true,
});

export const POPULAR_SERVICES: readonly NormalizedService[] = [
  service('hair-color', 'Hair Color', 'hair', 'Hair styling', ['dye']),
  service('hair-styling', 'Hair Styling', 'hair', 'Hair styling'),
  service('hair-braids', 'Hair Braids', 'braids-locs', 'Braids', ['braiding']),
  service('female-haircut', 'Female Haircut', 'hair', 'Haircuts'),
  service('loc-retwist', 'Loc Retwist', 'braids-locs', 'Locs', ['dreadlock retwist']),
  service('eyebrow-waxing', 'Eyebrow Waxing', 'brows-lashes', 'Brows'),
  service('eyelash-extensions', 'Eyelash Extensions', 'brows-lashes', 'Lashes', ['lash extensions']),
  service('natural-hair-stylists', 'Natural Hair Stylists', 'hair', 'Natural hair'),
  service('locs', 'Locs', 'braids-locs', 'Locs'),
  service('sew-in-weave', 'Sew In Weave', 'hair', 'Extensions'),
  service('hair-extensions', 'Hair Extensions', 'hair', 'Extensions'),
  service('hair-care', 'Hair Care', 'hair', 'Treatments'),
  service('box-braids', 'Box Braids', 'braids-locs', 'Braids'),
  service('facial', 'Facial', 'skin-care', 'Facials', ['facial treatment']),
  service('hair-wash', 'Hair Wash', 'hair', 'Hair care'),
  service('highlights', 'Highlights', 'hair', 'Hair color'),
  service('knotless-braids', 'Knotless Braids', 'braids-locs', 'Braids'),
  service('silk-press', 'Silk Press', 'hair', 'Natural hair'),
  service('male-haircut', 'Male Haircut', 'barber', 'Haircuts', ['barber cut']),
  service('loc-maintenance', 'Loc Maintenance', 'braids-locs', 'Locs'),
  service('deep-conditioning', 'Deep Conditioning Treatment', 'hair', 'Treatments'),
  service('crochet-braids', 'Crochet Braids', 'braids-locs', 'Braids'),
  service('starter-locs', 'Starter Locs', 'braids-locs', 'Locs'),
  service('pedicure', 'Pedicure', 'nails', 'Nail care'),
  service('blow-dry', 'Blow Dry', 'hair', 'Hair styling'),
  service('haircut-beard', 'Haircut & Beard', 'barber', 'Barbering', ['haircut and beard']),
  service('eyebrow-tinting', 'Eyebrow Tinting', 'brows-lashes', 'Brows'),
  service('updos', 'Updos', 'hair', 'Hair styling'),
  service('quick-weave', 'Quick Weave', 'hair', 'Extensions'),
  service('lip-waxing', 'Lip Waxing', 'hair-removal', 'Waxing'),
] as const;

export const BUSINESS_TYPE_GROUPS = [
  { group: 'Beauty & Grooming', types: ['Barber Shop', 'Hair Salon', 'Hair Stylist', 'Braiding Studio', 'Natural Hair', 'Wig / Extensions', 'Nail Salon', 'Makeup Artist', 'Lashes', 'Brows', 'Skincare', 'Spa', 'Massage'] },
  { group: 'Health & Wellness', types: ['Wellness Center', 'Physiotherapy', 'Nutrition', 'Personal Trainer', 'Fitness Studio', 'Yoga', 'Pilates', 'Gym', 'Clinic', 'Dental', 'Optical'] },
  { group: 'Home Services', types: ['Cleaning', 'Plumbing', 'Electrical', 'Painting', 'Carpentry', 'Interior Design', 'Landscaping', 'Pest Control', 'Handyman', 'Appliance Repair'] },
  { group: 'Automotive', types: ['Mechanic', 'Auto Repair', 'Detailing', 'Car Wash', 'Tire Service', 'Auto Electrical', 'Body Shop', 'Motorcycle Repair'] },
  { group: 'Fashion', types: ['Tailor', 'Fashion Designer', 'Alterations', 'Bespoke Clothing', 'Shoemaker', 'Leatherworks', 'Jewelry', 'Bridal Services'] },
  { group: 'Events & Creative', types: ['Photography', 'Videography', 'Event Planning', 'Decor', 'DJ', 'Catering', 'Baking', 'Florist', 'Creative Studio'] },
  { group: 'Professional Services', types: ['Consulting', 'Accounting', 'Tax', 'Legal', 'IT Support', 'Device Repair', 'Printing', 'Marketing', 'Tutoring', 'Training'] },
  { group: 'Pet Services', types: ['Pet Grooming', 'Veterinary', 'Dog Walking', 'Pet Sitting', 'Pet Training'] },
  { group: 'Hospitality', types: ['Restaurant Reservations', 'Private Chef', 'Travel Consultant', 'Tour Guide', 'Short-Let Service', 'Concierge'] },
] as const;

export const OTHER_BUSINESS_TYPE = "Other / My business isn't listed";

export const SUGGESTED_SERVICES_BY_BUSINESS: Readonly<Record<string, readonly string[]>> = {
  'Barber Shop': ['Male Haircut', 'Haircut & Beard', 'Beard Trim', 'Line Up', 'Kids Haircut'],
  'Hair Salon': ['Hair Styling', 'Hair Wash', 'Silk Press', 'Hair Color', 'Hair Extensions', 'Hair Braids'],
  'Braiding Studio': ['Box Braids', 'Knotless Braids', 'Crochet Braids', 'Starter Locs'],
  'Nail Salon': ['Manicure', 'Pedicure', 'Gel Nails', 'Nail Art'],
  Cleaning: ['Home Cleaning', 'Office Cleaning', 'Deep Cleaning', 'Move-in Cleaning'],
};

export const PRIMARY_CATEGORIES = SERVICE_CATEGORIES.filter((item) => item.featured && item.active);
export const MORE_CATEGORY_GROUPS = SERVICE_CATEGORIES.filter((item) => !item.featured && item.active).reduce<Record<string, ServiceCategory[]>>((groups, item) => {
  (groups[item.group] ??= []).push(item);
  return groups;
}, {});

export function findCategory(value: string) {
  const normalized = value.trim().toLowerCase();
  return SERVICE_CATEGORIES.find((item) => item.id === normalized || item.label.toLowerCase() === normalized || item.aliases.some((alias) => alias.toLowerCase() === normalized));
}

export function searchableText(values: readonly (string | undefined)[]) {
  return values.filter(Boolean).join(' ').toLowerCase();
}
