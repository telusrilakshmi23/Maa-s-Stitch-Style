import { PrismaClient, ProductKind } from '@prisma/client';
import bcrypt from 'bcryptjs';
const db = new PrismaClient();
async function main(){
 const email=process.env.ADMIN_EMAIL?.trim().toLowerCase(); const password=process.env.ADMIN_PASSWORD;
 if(!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Set a valid ADMIN_EMAIL before running the seed.');
 if(!password || password.length < 12 || password.startsWith('replace-with-')) throw new Error('Set a unique ADMIN_PASSWORD of at least 12 characters before running the seed.');
 await db.adminUser.upsert({where:{email},update:{},create:{email,passwordHash:await bcrypt.hash(password,12)}});
 await db.businessSettings.upsert({where:{id:1},update:{},create:{}});
 if(process.env.SEED_DEMO==='true' && !(await db.product.count())) await db.product.createMany({data:[
 {name:'The Gulmohar Kurti',description:'A graceful everyday silhouette, finished with thoughtful hand details. Demo catalogue item — replace with a genuine boutique garment before accepting orders.',price:'1890.00',category:'Kurtis',fabric:'Cotton blend',colour:'Rose & ivory',sizes:['S','M','L','XL'],stock:0,active:false,kind:ProductKind.READY_MADE,featured:true,newArrival:true},
 {name:'Mogra Blouse',description:'A timeless blouse shape with a refined neckline. Demo catalogue item — replace with genuine product photography and details.',price:'1490.00',category:'Blouses',fabric:'Silk blend',colour:'Deep plum',sizes:['S','M','L'],stock:0,active:false,kind:ProductKind.READY_MADE,featured:true},
 {name:'Ivory Garden Dress',description:'An easy flowing dress in a soft floral print. Demo catalogue item — replace before accepting orders.',price:'2490.00',category:'Dresses',fabric:'Viscose',colour:'Ivory floral',sizes:['M','L','XL'],stock:0,active:false,kind:ProductKind.READY_MADE,newArrival:true}
]});
}
main().finally(()=>db.$disconnect());
