-- Seed catalog (migrated from the front-end mock). Idempotent via INSERT OR IGNORE on id.
INSERT OR IGNORE INTO cards (id,title,category,grader,grade,tag,emoji,price_cents,sort) VALUES
 ('p1','Charizard VMAX — Rainbow Rare','Pokémon','PSA','10','Grail','🔥',145000,10),
 ('p2','Victor Wembanyama RC Prizm','Basketball','PSA','9','Rookie','🏀',62000,20),
 ('p3','Umbreon VMAX Alt Art','Pokémon','BGS','9.5','Hot','🌙',54000,30),
 ('p4','Patrick Mahomes Silver Prizm','Football','PSA','10','','🏈',41000,40),
 ('p5','Ronald Acuña Jr. Auto /25','Baseball','Raw','Raw','Auto','⚾',28500,50),
 ('p6','Base Set Blastoise Holo','Pokémon','PSA','8','Vintage','💧',79000,60),
 ('p7','Ja Morant Optic Fast Break','Basketball','PSA','10','','🏀',22500,70),
 ('p8','Monkey D. Luffy Leader Parallel','One Piece','Raw','Raw','TCG','🏴‍☠️',9500,80);
