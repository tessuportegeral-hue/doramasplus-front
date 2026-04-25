import { Link } from "react-router-dom";
import { Play } from "lucide-react";

export default function Privacidade() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      {/* Header simples */}
      <header className="border-b border-slate-800 bg-slate-950/95">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2 group">
            <Play className="w-7 h-7 text-purple-500 fill-purple-500" />
            <span className="text-lg font-bold text-white">DoramasPlus</span>
          </Link>
        </div>
      </header>

      {/* Conteúdo */}
      <main className="container mx-auto px-4 sm:px-6 lg:px-8 py-12 max-w-3xl">
        <h1 className="text-3xl font-bold text-white mb-2">Política de Privacidade</h1>
        <p className="text-slate-400 text-sm mb-10">Vigência a partir de abril de 2026</p>

        <Section title="1. Quais dados coletamos">
          <p>Ao utilizar o DoramasPlus, podemos coletar os seguintes dados pessoais:</p>
          <ul>
            <li><strong>E-mail e nome</strong> — fornecidos no cadastro e usados para identificação da conta.</li>
            <li><strong>Número de WhatsApp</strong> — coletado para suporte e comunicação com o usuário.</li>
            <li><strong>Histórico de visualização</strong> — títulos assistidos e progresso em cada episódio, para oferecer a funcionalidade "continuar assistindo".</li>
            <li><strong>Dados de pagamento</strong> — processados por terceiros (Stripe e InfinityPay). Não armazenamos dados de cartão de crédito em nossos servidores.</li>
            <li><strong>Dados técnicos</strong> — informações de sessão, endereço IP e dispositivo, coletados automaticamente para segurança e controle de acesso.</li>
          </ul>
        </Section>

        <Section title="2. Como usamos os dados">
          <p>Os dados coletados são utilizados exclusivamente para:</p>
          <ul>
            <li>Criar e gerenciar sua conta na plataforma.</li>
            <li>Controlar o acesso à assinatura ativa e verificar o status do plano.</li>
            <li>Salvar e exibir seu progresso de visualização.</li>
            <li>Prestar suporte via WhatsApp e e-mail.</li>
            <li>Prevenir acessos simultâneos não autorizados (controle de sessão única).</li>
            <li>Enviar comunicações sobre sua assinatura (vencimento, renovação).</li>
          </ul>
          <p>Não vendemos, alugamos nem compartilhamos seus dados com terceiros para fins de marketing.</p>
        </Section>

        <Section title="3. Integrações com terceiros">
          <p>O DoramasPlus utiliza os seguintes serviços de terceiros, cada um com sua própria política de privacidade:</p>
          <ul>
            <li>
              <strong>Supabase</strong> — banco de dados, autenticação e armazenamento de arquivos.
              Seus dados são armazenados em servidores seguros na região da América do Sul (sa-east-1).
            </li>
            <li>
              <strong>Stripe</strong> — processamento de pagamentos com cartão de crédito.
              Os dados financeiros são tratados diretamente pelo Stripe, conforme a{" "}
              <a href="https://stripe.com/br/privacy" target="_blank" rel="noreferrer" className="text-purple-400 hover:underline">
                política de privacidade do Stripe
              </a>.
            </li>
            <li>
              <strong>InfinityPay</strong> — processamento de pagamentos via PIX.
              Os dados de pagamento são tratados diretamente pela InfinityPay.
            </li>
            <li>
              <strong>Meta (Facebook Pixel)</strong> — utilizado para mensurar conversões e alcance de campanhas publicitárias.
              Nenhum dado sensível é compartilhado.
            </li>
          </ul>
        </Section>

        <Section title="4. Cookies e armazenamento local">
          <p>Utilizamos cookies e armazenamento local (<code className="text-purple-300 text-sm">localStorage</code>) para:</p>
          <ul>
            <li>Manter sua sessão ativa após o login.</li>
            <li>Armazenar preferências da interface (ex.: modo de exibição).</li>
            <li>Registrar a origem do acesso (parâmetro <code className="text-purple-300 text-sm">?src=</code>) para fins de análise de tráfego.</li>
            <li>Controlar o período de teste gratuito para usuários não cadastrados.</li>
          </ul>
          <p>
            Você pode limpar os dados armazenados a qualquer momento pelas configurações do seu navegador.
            Isso pode desconectar você da plataforma.
          </p>
        </Section>

        <Section title="5. Retenção de dados">
          <p>
            Mantemos seus dados enquanto sua conta estiver ativa. Após a exclusão da conta, os dados
            são removidos de nossos sistemas em até 30 dias, salvo obrigação legal de retenção.
          </p>
        </Section>

        <Section title="6. Seus direitos">
          <p>Você tem o direito de:</p>
          <ul>
            <li>Acessar os dados que temos sobre você.</li>
            <li>Solicitar a correção de dados incorretos.</li>
            <li>Solicitar a exclusão completa da sua conta e de todos os seus dados.</li>
            <li>Revogar consentimentos previamente fornecidos.</li>
          </ul>
          <p>
            Para exercer seus direitos, você pode:
          </p>
          <ul>
            <li>
              Usar o botão <strong>"Excluir minha conta"</strong> disponível no menu da plataforma
              (exclui a conta imediatamente).
            </li>
            <li>
              Entrar em contato pelo e-mail{" "}
              <a href="mailto:tessuportegeral@gmail.com" className="text-purple-400 hover:underline">
                tessuportegeral@gmail.com
              </a>.
            </li>
          </ul>
        </Section>

        <Section title="7. Segurança">
          <p>
            Adotamos medidas técnicas e organizacionais para proteger seus dados contra acesso não
            autorizado, alteração, divulgação ou destruição. O acesso à plataforma é protegido por
            autenticação e controle de sessão única.
          </p>
        </Section>

        <Section title="8. Contato">
          <p>
            Em caso de dúvidas sobre esta Política de Privacidade, entre em contato com o responsável
            pelo tratamento de dados:
          </p>
          <p>
            <strong>E-mail:</strong>{" "}
            <a href="mailto:tessuportegeral@gmail.com" className="text-purple-400 hover:underline">
              tessuportegeral@gmail.com
            </a>
          </p>
          <p>
            <strong>Plataforma:</strong>{" "}
            <a href="https://doramasplus.com.br" className="text-purple-400 hover:underline">
              doramasplus.com.br
            </a>
          </p>
        </Section>

        <p className="text-slate-500 text-sm mt-12 pt-8 border-t border-slate-800">
          Esta política pode ser atualizada periodicamente. A data de vigência no topo desta página
          indica a versão mais recente.
        </p>

        <div className="mt-8">
          <Link to="/" className="text-purple-400 hover:text-purple-300 text-sm">
            ← Voltar para o início
          </Link>
        </div>
      </main>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="mb-10">
      <h2 className="text-lg font-bold text-white mb-4 pb-2 border-b border-slate-800">{title}</h2>
      <div className="text-slate-300 text-sm leading-relaxed space-y-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-2 [&_strong]:text-slate-100">
        {children}
      </div>
    </section>
  );
}
