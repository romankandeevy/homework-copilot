import { readFileSync } from 'node:fs'
const env = Object.fromEntries(readFileSync('.env.local','utf8').split(/\r?\n/).filter(l=>l.includes('='))
  .map(l=>[l.slice(0,l.indexOf('=')).trim(), l.slice(l.indexOf('=')+1).trim()]))
const URL_=env.VITE_SUPABASE_URL, KEY=env.VITE_SUPABASE_PUBLISHABLE_KEY
const email=`e2e-solve-${Date.now()}@homeworkcopilot.ru`, password='Qw8!zRt5#nVp2024'
const su=await fetch(`${URL_}/auth/v1/signup`,{method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},
  body:JSON.stringify({email,password,data:{full_name:'E2E решение',grade:8}})})
const sub=await su.json()
console.log('EMAIL:',email)
console.log('userId:',sub.user?.id ?? sub.id ?? '?')
