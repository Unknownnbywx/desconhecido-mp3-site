# Configuração de vídeos, lives e notificações push

## Publicações de vídeos e lives

1. No Supabase, abra **SQL Editor**. Caso ainda não tenham sido aplicados, execute primeiro `feedback-replies-schema.sql` e depois `updates-schema.sql`.
2. Execute `site-media-push-schema.sql` para adicionar os campos de vídeo/live e criar a tabela privada de inscrições push.
3. Faça login na área do responsável do site. Escolha **Vídeo do YouTube** ou **Live ou replay do YouTube**, preencha o título/descrição e cole o link. São aceitos links de vídeos, Shorts, lives, links curtos `youtu.be` e links de canal no formato `youtube.com/@seucanal/live`.

As publicações continuam protegidas pela política `is_feedback_site_owner()` existente. Não altere as políticas RLS para permitir publicação anônima.

## Notificações mesmo com o site fechado

O site precisa estar hospedado em HTTPS. Publique `index.html` (página inicial padrão), `UnknownMP3SITEEE.html`, `sw.js`, `manifest.webmanifest` e `channels4_profile.jpg`, mantendo-os no mesmo diretório.

1. Gere um par VAPID localmente com Node.js e guarde a chave privada apenas no cofre de secrets do Supabase. No PowerShell, execute:

   ```powershell
   node -e "const c=require('node:crypto').createECDH('prime256v1');c.generateKeys();console.log(JSON.stringify({publicKey:c.getPublicKey(undefined,'uncompressed').toString('base64url'),privateKey:c.getPrivateKey().toString('base64url')},null,2))"
   ```

   Não publique nem coloque a chave privada no HTML ou no Git.

2. No painel do Supabase, abra as secrets das Edge Functions e cadastre `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` e `VAPID_SUBJECT` com os valores gerados e um e-mail de contato válido. Não passe a chave privada como argumento de linha de comando. Depois, associe a CLI ao projeto:

   ```powershell
   supabase link --project-ref zmfsomzlqcgsdeahcboc
   ```

3. No diretório do site, publique as duas funções:

   ```powershell
   supabase functions deploy manage-site-push
   supabase functions deploy send-site-push
   ```

4. Abra o site em cada dispositivo, toque em **Ativar notificações neste dispositivo** e permita as notificações. A foto de perfil do canal aparece como ícone.

O navegador exige consentimento por dispositivo. Alguns navegadores móveis só entregam push com o site instalado na tela inicial. A inscrição pode ser removida nas configurações de notificações do próprio navegador/dispositivo.
