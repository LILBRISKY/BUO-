INSERT INTO categories (id, name, slug, description) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Phones', 'phones', 'Mobile devices and accessories'),
  ('22222222-2222-2222-2222-222222222222', 'Laptops', 'laptops', 'Portable computing products'),
  ('33333333-3333-3333-3333-333333333333', 'Electronics', 'electronics', 'Audio, connected devices and electronics'),
  ('44444444-4444-4444-4444-444444444444', 'Gaming', 'gaming', 'Games, consoles and gaming gear'),
  ('55555555-5555-5555-5555-555555555555', 'Appliances', 'appliances', 'Home and household appliances'),
  ('66666666-6666-6666-6666-666666666666', 'Fashion', 'fashion', 'Apparel, footwear and accessories'),
  ('77777777-7777-7777-7777-777777777777', 'Beauty', 'beauty', 'Skincare, cosmetics and personal care'),
  ('88888888-8888-8888-8888-888888888888', 'Sports', 'sports', 'Fitness and outdoor activity equipment'),
  ('99999999-9999-9999-9999-999999999999', 'Home', 'home', 'Home and décor essentials'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Baby', 'baby', 'For babies and toddlers'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Automotive', 'automotive', 'Auto accessories and care'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Books', 'books', 'Education and inspiration'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'Pets', 'pets', 'Pet accessories and essentials')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO users (id, name, email, phone, password_hash, role) VALUES
  ('0a0a0a0a-0a0a-0a0a-0a0a-0a0a0a0a0a0a', 'BUO Admin', 'admin@buo.ng', '+2348000000001', '$2b$10$kyUHEDByEUYQw7JoUr1y5eiTVxH8Qq4uaEUVISMyGAQ2iaaeyRWeu', 'ADMIN'),
  ('1b1b1b1b-1b1b-1b1b-1b1b-1b1b1b1b1b1b', 'Ada Okafor', 'ada@buo.ng', '+2348123456789', '$2b$10$kyUHEDByEUYQw7JoUr1y5eiTVxH8Qq4uaEUVISMyGAQ2iaaeyRWeu', 'CUSTOMER')
ON CONFLICT (email) DO NOTHING;

INSERT INTO coupons (id, code, type, value, description, active) VALUES
  ('feedfeed-feef-feef-feef-feedfeedfeedef', 'BUO10', 'percent', 10, '10% off selected electronics', TRUE),
  ('b9b9b9b9-b9b9-b9b9-b9b9-b9b9b9b9b9b9', 'NAIRA5', 'fixed', 5000, '₦5,000 off orders above ₦50,000', TRUE)
ON CONFLICT (code) DO NOTHING;
