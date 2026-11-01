import {afterEach,expect,it,vi} from 'vitest'
import {api,setCredential,uploadFile} from './realityClient'
afterEach(()=>{vi.unstubAllGlobals();setCredential('')})
const file=()=>new File(['photo'],'project.jpg',{type:'image/jpeg'})
it('explains an upload connection failure without retrying a mutation automatically',async()=>{const fetch=vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));vi.stubGlobal('fetch',fetch);await expect(uploadFile(file())).rejects.toThrow('Image upload could not connect');expect(fetch).toHaveBeenCalledTimes(1)})
it('expires authentication after a rejected upload and distinguishes a file size limit',async()=>{setCredential('expired');vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('',{status:401})));await expect(uploadFile(file())).rejects.toThrow('Session expired');vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('',{status:413})));await expect(uploadFile(file())).rejects.toThrow('too large')})
it('explains an asset saving connection failure without submitting twice',async()=>{const fetch=vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));vi.stubGlobal('fetch',fetch);await expect(api('/assets',{})).rejects.toThrow('Could not connect to the server');expect(fetch).toHaveBeenCalledTimes(1)})
