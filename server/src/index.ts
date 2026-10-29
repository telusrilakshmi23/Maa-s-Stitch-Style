import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import session from 'express-session';
import pgSession from 'connect-pg-simple';
import { Pool } from 'pg';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { PrismaClient, Prisma, OrderStatus, CustomStatus } from '@prisma/client';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { orderAvailabilityError } from './order-rules.js';
import { createAdminMiddleware } from './admin-auth.js';
import { detectSupportedImage } from './upload-validation.js';

const required=['DATABASE_URL','SESSION_SECRET']; for(const key of required) if(!process.env[key]) throw new Error(`Missing ${key}`);
if(process.env.NODE_ENV==='production' && (process.env.SESSION_SECRET?.length??0)<32) throw new Error('SESSION_SECRET must be at least 32 characters in production');
const db=new PrismaClient(); const app=express(); const port=Number(process.env.PORT||4000);
const pool=new Pool({connectionString:process.env.DATABASE_URL}); const PgStore=pgSession(session);
const referenceBucket=process.env.S3_REFERENCE_BUCKET;
const productBucket=process.env.S3_PRODUCT_BUCKET;
if(referenceBucket&&productBucket&&referenceBucket===productBucket) throw new Error('Use separate S3 buckets for private reference images and public product images');
const accessKeyId=process.env.S3_ACCESS_KEY_ID;
const secretAccessKey=process.env.S3_SECRET_ACCESS_KEY;
if(Boolean(accessKeyId)!==Boolean(secretAccessKey)) throw new Error('Set both S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY, or leave both blank');
if((referenceBucket||productBucket)&&(!accessKeyId||!secretAccessKey||!process.env.S3_ENDPOINT)) throw new Error('Configure S3_ENDPOINT and both S3 credentials when an image bucket is set');
const s3=new S3Client({region:process.env.S3_REGION||'auto',endpoint:process.env.S3_ENDPOINT||undefined,credentials:accessKeyId&&secretAccessKey?{accessKeyId,secretAccessKey}:undefined});
const isProduction=process.env.NODE_ENV==='production';
const allowedOrigins=(process.env.CLIENT_ORIGINS||process.env.CLIENT_ORIGIN||(isProduction?'':'http://localhost:5173')).split(',').map(origin=>origin.trim()).filter(Boolean);
app.set('trust proxy',1); app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],imgSrc:["'self'","data:","blob:","https:"],styleSrc:["'self'","'unsafe-inline'","https://fonts.googleapis.com"],fontSrc:["'self'","https://fonts.gstatic.com","data:"],objectSrc:["'none'"],frameAncestors:["'none'"]}}})); app.use(cors({origin:(origin,callback)=>callback(null,!origin||allowedOrigins.includes(origin)),credentials:true})); app.use(express.json({limit:'1mb'}));
app.use(session({store:new PgStore({pool,createTableIfMissing:true}),secret:process.env.SESSION_SECRET!,resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:isProduction?'none':'lax',secure:isProduction||process.env.COOKIE_SECURE==='true',maxAge:8*60*60*1000}}));
const loginLimit=rateLimit({windowMs:15*60*1000,limit:8,standardHeaders:true,legacyHeaders:false});
const submissionLimit=rateLimit({windowMs:60*60*1000,limit:12,standardHeaders:true,legacyHeaders:false});
type Req=express.Request & {session: express.Request['session'] & {adminId?:string}};
const admin=createAdminMiddleware(allowedOrigins);
const bad=(res:express.Response,error:unknown)=>{console.error(error);res.status(400).json({error:error instanceof z.ZodError?error.issues[0]?.message:'We could not complete that request. Please check your details and try again.'})};
const reference=(prefix:string)=>`${prefix}-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${randomUUID().slice(0,6).toUpperCase()}`;
const phoneSchema=z.string().trim().min(8).max(20).regex(/^[+\d()\s-]+$/,'Enter a valid phone number.');
const amountSchema=z.union([z.string().trim(),z.number().finite()]).transform(value=>String(value)).refine(value=>/^(0|[1-9]\d{0,6})(\.\d{1,2})?$/.test(value)&&Number(value)>0&&Number(value)<=1000000,'Enter an amount up to ₹10,00,000 with no more than two decimal places.');
const productSchema=z.object({name:z.string().trim().min(2).max(120),description:z.string().trim().min(5).max(3000),price:amountSchema,category:z.string().trim().min(2).max(60),collection:z.string().max(80).optional(),fabric:z.string().max(80).optional(),colour:z.string().max(80).optional(),sizes:z.array(z.string().max(20)).max(20),stock:z.coerce.number().int().min(0),kind:z.enum(['READY_MADE','MADE_TO_ORDER']),featured:z.boolean(),newArrival:z.boolean(),active:z.boolean()});
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024,files:1,fields:22,fieldSize:10*1024,parts:23}});
const productUpload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024,files:6,fields:0,parts:6}});
app.get('/api/health',async(_req,res)=>{try{await db.$queryRaw`SELECT 1`;res.json({status:'ok'})}catch{res.status(503).json({status:'unavailable'})}});
app.get('/api/settings',async(_req,res)=>{try{const s=await db.businessSettings.findUnique({where:{id:1}});res.json({name:s?.name||"Maa's Stitch & Style",tagline:s?.description||'Stitched with Love. Styled by You.',whatsappNumber:s?.whatsappNumber||process.env.BUSINESS_WHATSAPP_NUMBER||'',phone:s?.phone||process.env.BUSINESS_PHONE||'',email:s?.email||process.env.BUSINESS_EMAIL||'',instagramUrl:s?.instagramUrl||'',deliveryAreas:s?.deliveryAreas||['Rajahmundry','Nearby areas by arrangement'],pickupInfo:s?.pickupInfo||'Delivery coverage is confirmed with each request.'})}catch(e){bad(res,e)}});
app.get('/api/products',async(req,res)=>{try{const query=z.object({category:z.string().optional(),search:z.string().max(100).optional(),sort:z.enum(['newest','price-asc','price-desc']).default('newest'),featured:z.coerce.boolean().optional()}).parse(req.query);const items=await db.product.findMany({where:{active:true,...(query.category?{category:query.category}:{}),...(query.featured?{featured:true}:{}),...(query.search?{OR:[{name:{contains:query.search,mode:'insensitive'}},{description:{contains:query.search,mode:'insensitive'}}]}:{})},include:{images:{orderBy:{sortOrder:'asc'}}},orderBy:query.sort==='price-asc'?{price:'asc'}:query.sort==='price-desc'?{price:'desc'}:{createdAt:'desc'}});res.json(items)}catch(e){bad(res,e)}});
app.get('/api/products/:id',async(req,res)=>{try{const item=await db.product.findFirst({where:{id:String(req.params.id),active:true},include:{images:{orderBy:{sortOrder:'asc'}}}});if(!item)return res.status(404).json({error:'This piece is no longer available.'});res.json(item)}catch(e){bad(res,e)}});
app.post('/api/orders',submissionLimit,async(req,res)=>{try{const data=z.object({productId:z.string(),size:z.string().min(1),quantity:z.coerce.number().int().min(1).max(10),customerName:z.string().trim().min(2).max(100),phone:phoneSchema,email:z.string().email().optional().or(z.literal('')),deliveryArea:z.string().trim().min(2).max(120),instructions:z.string().max(1000).optional()}).parse(req.body);const result=await db.$transaction(async tx=>{const p=await tx.product.findFirst({where:{id:data.productId,active:true}});if(!p)throw new Error('This item is currently unavailable.');const availabilityError=orderAvailabilityError(p,data.size,data.quantity);if(availabilityError)throw new Error(availabilityError);if(p.kind==='READY_MADE'){const reserved=await tx.product.updateMany({where:{id:p.id,active:true,stock:{gte:data.quantity},sizes:{has:data.size}},data:{stock:{decrement:data.quantity}}});if(reserved.count!==1)throw new Error('Availability changed. Please refresh and choose another size or quantity.')}return tx.readyOrder.create({data:{reference:reference('MS'),customerName:data.customerName,phone:data.phone,email:data.email||null,deliveryArea:data.deliveryArea,instructions:data.instructions,items:{create:{productId:p.id,productName:p.name,size:data.size,quantity:data.quantity,unitPrice:p.price}}},include:{items:true}})});res.status(201).json({reference:result.reference,status:result.status})}catch(e){bad(res,e)}});
app.post('/api/custom-requests',submissionLimit,upload.single('referenceImage'),async(req,res)=>{let key:string|undefined;try{const data=z.object({customerName:z.string().trim().min(2).max(100),phone:phoneSchema,email:z.string().email().optional().or(z.literal('')),garmentType:z.string().min(2).max(60),description:z.string().trim().min(10).max(3000),fabric:z.string().max(80).optional(),colour:z.string().max(80).optional(),neckDesign:z.string().max(120).optional(),sleeveDesign:z.string().max(120).optional(),preferredSize:z.string().max(30).optional(),measurements:z.string().optional(),quantity:z.coerce.number().int().min(1).max(10),budget:z.string().max(80).optional(),preferredDate:z.string().optional(),deliveryArea:z.string().trim().min(2).max(120),instructions:z.string().max(1000).optional()}).parse(req.body);if(!req.file)throw new Error('Please add one reference image to help us understand your design.');const actual=await detectSupportedImage(req.file.buffer);if(!actual)throw new Error('Upload a JPEG, PNG, or WebP image.');if(!referenceBucket)throw new Error('Private reference-image storage is not configured yet. Please contact us directly while we set up storage.');key=`references/${randomUUID()}.${actual.ext}`;await s3.send(new PutObjectCommand({Bucket:referenceBucket,Key:key,Body:req.file.buffer,ContentType:actual.mime,ServerSideEncryption:'AES256'}));let measurements:unknown=null; if(data.measurements){try{measurements=JSON.parse(data.measurements)}catch{measurements=data.measurements.slice(0,1000)}}const record=await db.customRequest.create({data:{reference:reference('CS'),customerName:data.customerName,phone:data.phone,email:data.email||null,garmentType:data.garmentType,description:data.description,fabric:data.fabric,colour:data.colour,neckDesign:data.neckDesign,sleeveDesign:data.sleeveDesign,preferredSize:data.preferredSize,measurements:measurements as Prisma.InputJsonValue,quantity:data.quantity,budget:data.budget,preferredDate:data.preferredDate?new Date(data.preferredDate):null,deliveryArea:data.deliveryArea,instructions:data.instructions,images:{create:{storageKey:key,mimeType:actual.mime,size:req.file.size}}}});res.status(201).json({reference:record.reference,status:record.status})}catch(e){if(key&&referenceBucket)await s3.send(new DeleteObjectCommand({Bucket:referenceBucket,Key:key})).catch(()=>{});bad(res,e)}});
app.post('/api/admin/login',loginLimit,async(req,res)=>{try{const data=z.object({email:z.string().email(),password:z.string().min(1).max(200)}).parse(req.body);const user=await db.adminUser.findUnique({where:{email:data.email.toLowerCase()}});if(!user||!(await bcrypt.compare(data.password,user.passwordHash)))return res.status(401).json({error:'Email or password was not recognized.'});(req as Req).session.adminId=user.id;req.session.regenerate((err)=>{if(err)return res.status(500).json({error:'Unable to start a secure session.'});(req as Req).session.adminId=user.id;res.json({email:user.email})})}catch(e){bad(res,e)}});
app.post('/api/admin/logout',admin,(req:Req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get('/api/admin/me',admin,(req:Req,res)=>res.json({id:req.session.adminId}));
app.get('/api/admin/overview',admin,async(_req,res)=>{try{const [activeProducts,pendingOrders,pendingCustom,orders,custom]=await Promise.all([db.product.count({where:{active:true}}),db.readyOrder.count({where:{status:'PENDING'}}),db.customRequest.count({where:{status:'PENDING_REVIEW'}}),db.readyOrder.findMany({take:8,orderBy:{createdAt:'desc'},include:{items:true}}),db.customRequest.findMany({take:8,orderBy:{createdAt:'desc'}})]);res.json({activeProducts,pendingOrders,pendingCustom,orders,custom})}catch(e){bad(res,e)}});
app.get('/api/admin/products',admin,async(_req,res)=>res.json(await db.product.findMany({include:{images:true},orderBy:{updatedAt:'desc'}})));
app.post('/api/admin/products',admin,async(req,res)=>{try{const data=productSchema.parse(req.body);const p=await db.product.create({data:{...data,price:new Prisma.Decimal(data.price)}});res.status(201).json(p)}catch(e){bad(res,e)}});
app.put('/api/admin/products/:id',admin,async(req,res)=>{try{const data=productSchema.parse(req.body);const p=await db.product.update({where:{id:String(req.params.id)},data:{...data,price:new Prisma.Decimal(data.price)}});res.json(p)}catch(e){bad(res,e)}});
app.delete('/api/admin/products/:id',admin,async(req,res)=>{try{await db.product.update({where:{id:String(req.params.id)},data:{active:false}});res.json({ok:true})}catch(e){bad(res,e)}});
app.post('/api/admin/products/:id/images', admin, productUpload.array('images', 6), async (req, res) => {
  const files = Array.isArray(req.files) ? req.files as Express.Multer.File[] : [];
  const uploaded: { key: string; url: string; alt: string; sortOrder: number }[] = [];
  try {
    const productId = String(req.params.id);
    if (!await db.product.findUnique({ where: { id: productId } })) return res.status(404).json({ error: 'Product not found.' });
    const publicBase = process.env.S3_PUBLIC_BASE_URL?.replace(/\/$/, '');
    if (!productBucket || !publicBase) throw new Error('Configure the public product-image bucket and base URL before uploading photos.');
    if (!files.length) throw new Error('Choose at least one product photograph.');
    for (const [index, file] of files.entries()) {
      const type = await detectSupportedImage(file.buffer);
      if (!type) throw new Error('Use JPEG, PNG or WebP product photos.');
      const key = `products/${randomUUID()}.${type.ext}`;
      await s3.send(new PutObjectCommand({ Bucket: productBucket, Key: key, Body: file.buffer, ContentType: type.mime, ServerSideEncryption: 'AES256' }));
      uploaded.push({ key, url: `${publicBase}/${key}`, alt: `${type.ext.toUpperCase()} product photograph`, sortOrder: index });
    }
    await db.productImage.createMany({ data: uploaded.map(image => ({ productId, storageKey: image.key, url: image.url, alt: image.alt, sortOrder: image.sortOrder })) });
    res.status(201).json({ added: uploaded.length });
  } catch (error) {
    if (productBucket) await Promise.all(uploaded.map(image => s3.send(new DeleteObjectCommand({ Bucket: productBucket, Key: image.key })).catch(() => undefined)));
    bad(res, error);
  }
});
app.delete('/api/admin/product-images/:id', admin, async (req, res) => {
  try {
    const image = await db.productImage.findUnique({ where: { id: String(req.params.id) } });
    if (!image) return res.status(404).json({ error: 'Product image not found.' });
    if (productBucket) await s3.send(new DeleteObjectCommand({ Bucket: productBucket, Key: image.storageKey }));
    await db.productImage.delete({ where: { id: image.id } });
    res.json({ ok: true });
  } catch (error) {
    bad(res, error);
  }
});
app.get('/api/admin/orders',admin,async(_req,res)=>res.json(await db.readyOrder.findMany({include:{items:true},orderBy:{createdAt:'desc'}})));
app.patch('/api/admin/orders/:id', admin, async (req, res) => {
  try {
    const data = z.object({ status: z.nativeEnum(OrderStatus).optional(), internalNotes: z.string().max(2000).optional() }).parse(req.body);
    const id = String(req.params.id);
    const updated = await db.$transaction(async tx => {
      const current = await tx.readyOrder.findUnique({ where: { id }, include: { items: true } });
      if (!current) throw new Error('Order request not found.');
      if (['CANCELLED', 'COMPLETED'].includes(current.status) && data.status && data.status !== current.status) throw new Error('Closed requests cannot be reopened or changed.');
      if (data.status === 'CANCELLED' && current.status !== 'CANCELLED') {
        for (const item of current.items) {
          if (!item.productId) continue;
          const product = await tx.product.findUnique({ where: { id: item.productId } });
          if (product?.kind === 'READY_MADE') await tx.product.update({ where: { id: product.id }, data: { stock: { increment: item.quantity } } });
        }
      }
      return tx.readyOrder.update({ where: { id }, data });
    });
    res.json(updated);
  } catch (error) {
    bad(res, error);
  }
});
app.get('/api/admin/custom-requests', admin, async (_req, res) => {
  try {
    const rows = await db.customRequest.findMany({ include: { images: true }, orderBy: { createdAt: 'desc' } });
    const requests = await Promise.all(rows.map(async (request) => {
      const images = await Promise.all(request.images.map(async (image) => ({
        ...image,
        url: referenceBucket ? await getSignedUrl(s3, new GetObjectCommand({ Bucket: referenceBucket, Key: image.storageKey }), { expiresIn: 300 }) : '',
      })));
      return { ...request, images };
    }));
    res.json(requests);
  } catch (error) {
    bad(res, error);
  }
});
app.patch('/api/admin/custom-requests/:id',admin,async(req,res)=>{try{const data=z.object({status:z.nativeEnum(CustomStatus).optional(),internalNotes:z.string().max(2000).optional(),quotedPrice:amountSchema.optional(),agreedDeliveryDate:z.string().optional()}).parse(req.body);res.json(await db.customRequest.update({where:{id:String(req.params.id)},data:{...data,quotedPrice:data.quotedPrice?new Prisma.Decimal(data.quotedPrice):undefined,agreedDeliveryDate:data.agreedDeliveryDate?new Date(data.agreedDeliveryDate):undefined}}))}catch(e){bad(res,e)}});
app.get('/api/admin/settings',admin,async(_req,res)=>res.json(await db.businessSettings.upsert({where:{id:1},update:{},create:{}})));
app.put('/api/admin/settings',admin,async(req,res)=>{try{const data=z.object({name:z.string().min(2).max(100),description:z.string().max(300),whatsappNumber:z.string().max(30).optional(),phone:z.string().max(30).optional(),email:z.string().email().optional().or(z.literal('')),instagramUrl:z.string().url().optional().or(z.literal('')),deliveryAreas:z.array(z.string().min(2).max(100)).max(40),pickupInfo:z.string().max(500).optional(),currency:z.literal('INR')}).parse(req.body);res.json(await db.businessSettings.upsert({where:{id:1},update:data,create:{id:1,...data}}))}catch(e){bad(res,e)}});
app.use('/api',(_req,res)=>res.status(404).json({error:'Not found.'}));
app.use((err:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{if(err instanceof multer.MulterError)return res.status(400).json({error:err.code==='LIMIT_FILE_SIZE'?'Each image must be 5 MB or smaller.':'Choose no more than the allowed number of images.'});console.error(err);res.status(500).json({error:'Something went wrong. Please try again.'})});
app.listen(port,()=>console.log(`Maa's Stitch & Style API listening on ${port}`));
