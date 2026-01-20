import React, { useEffect, useState, useRef } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Helmet } from 'react-helmet';
import { Button } from '@/components/ui/button';
import {
  Trash2,
  Edit,
  Search,
  Plus,
  Save,
  X,
  Image as ImageIcon,
  Sparkles,
  Star,
  BadgeCheck,
  Globe,
  Layers,
  MonitorPlay,
  ArrowLeft,
  Baby,
  HeartHandshake,
  Eye,
} from 'lucide-react';
import { toast } from '@/components/ui/use-toast';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';

//
// Navegação do topo do Admin (Analytics | Doramas | Usuários)
//
const AdminTopNav = ({ current }) => {
  const navigate = useNavigate();

  const items = [
    { id: 'analytics', label: 'Analytics', path: '/admin/analytics' },
    { id: 'doramas', label: 'Doramas', path: '/admin/doramas' },
    { id: 'users', label: 'Usuários', path: '/admin/users' },
  ];

  return (
    <nav className="mt-4 border-b border-slate-800 pb-2">
      <div className="flex flex-wrap gap-2">
        {items.map((item) => {
          const isActive = current === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => navigate(item.path)}
              className={
                'px-3 py-1.5 text-sm rounded-md border transition-colors ' +
                (isActive
                  ? 'bg-purple-600 text-white border-purple-500 shadow-sm'
                  : 'bg-slate-900 text-slate-300 border-slate-700 hover:bg-slate-800')
              }
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
};

export default function AdminDoramas() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const bannerInputRef = useRef(null);

  // Admin data state
  const [doramas, setDoramas] = useState([]);
  const [loadingData, setLoadingData] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('all');

  // ✅ Paginação 10 em 10
  const PAGE_SIZE = 10;
  const [currentPage, setCurrentPage] = useState(1);
  const [totalDoramas, setTotalDoramas] = useState(0);

  // Form state
  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingSlug, setEditingSlug] = useState('');
  const [originalTitle, setOriginalTitle] = useState('');

  // File states
  const [coverFile, setCoverFile] = useState(null);
  const [bannerFile, setBannerFile] = useState(null);

  const [formData, setFormData] = useState({
    title: '',
    description: '',        // ✅ sinopse
    release_year: '',
    genres: '',
    duration_minutes: '',   // ✅ DURAÇÃO (coluna no banco)
    cover_url: '',
    banner_url: '',
    bunny_url: '',          // ✅ STORE (não mexer)
    bunny_stream_url: '',   // ✅ iPhone (Stream)
    is_exclusive: false,
    is_new: false,
    is_featured: false,
    is_recommended: false,
    is_baby_pregnancy: false,
    is_taboo_relationship: false,
    is_hidden_identity: false,
    language: 'legendado',
  });

  // Constants
  const ADMIN_EMAIL = 'tessuportegeral@gmail.com';
  const isAuthorized = !authLoading && user?.email === ADMIN_EMAIL;

  // Filter Tabs Configuration (mesma lógica do catálogo)
  const filterTabs = [
    { id: 'all', label: 'Todos', icon: Layers },
    { id: 'featured', label: 'Destaque / Banner', icon: Star },
    { id: 'new', label: 'Novos lançamentos', icon: BadgeCheck },
    { id: 'dubbed', label: 'Séries dubladas', icon: Globe },
    { id: 'baby', label: 'Bebês e gravidezes', icon: Baby },
    { id: 'taboo', label: 'Relacionamento tabu', icon: HeartHandshake },
    { id: 'hidden', label: 'Identidade escondida', icon: Eye },
    { id: 'recommended', label: 'Recomendados p/ você', icon: Sparkles },
  ];

  useEffect(() => {
    if (!authLoading) {
      if (!isAuthorized) {
        navigate('/');
      } else {
        fetchDoramas();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, isAuthorized, navigate]);

  // ✅ quando trocar aba ou busca, volta pra página 1
  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, searchQuery]);

  // ✅ refetch com paginação + filtros + busca
  useEffect(() => {
    if (isAuthorized) fetchDoramas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, activeTab, searchQuery, isAuthorized]);

  const fetchDoramas = async () => {
    setLoadingData(true);
    try {
      const from = (currentPage - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      let query = supabase
        .from('doramas')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false });

      const q = searchQuery.trim();

      // ✅ Ajuste: quando tiver busca, não pagina (pra não “sumir” doramas)
      // ✅ E melhora a busca: title OU slug (slug ajuda quando usuário digita sem acento)
      if (q) {
        // slugify local (igual o createSlug, mas aqui dentro pra não mexer na ordem do arquivo)
        const slugQ = q
          .toString()
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .trim()
          .replace(/\s+/g, '-')
          .replace(/[^\w\-]+/g, '')
          .replace(/\-\-+/g, '-');

        query = query.or(`title.ilike.%${q}%,slug.ilike.%${slugQ}%`);
      }

      switch (activeTab) {
        case 'featured':
          query = query.eq('is_featured', true);
          break;
        case 'new':
          query = query.eq('is_new', true);
          break;
        case 'dubbed':
          query = query.eq('language', 'dublado');
          break;
        case 'baby':
          query = query.eq('is_baby_pregnancy', true);
          break;
        case 'taboo':
          query = query.eq('is_taboo_relationship', true);
          break;
        case 'hidden':
          query = query.eq('is_hidden_identity', true);
          break;
        case 'recommended':
          query = query.eq('is_recommended', true);
          break;
        case 'all':
        default:
          break;
      }

      let data = [];
      let count = 0;

      if (q) {
        // ✅ com busca: SEM range (não pagina)
        const { data: d, error, count: c } = await query;

        if (error) throw error;

        data = d || [];
        count = (typeof c === 'number' ? c : data.length);
      } else {
        // ✅ sem busca: pagina normal 10 em 10
        const { data: d, error, count: c } = await query.range(from, to);

        if (error) throw error;

        data = d || [];
        count = c || 0;
      }

      setDoramas(data);
      setTotalDoramas(count);
    } catch (error) {
      console.error('Error fetching doramas:', error);
      toast({
        title: 'Erro ao carregar',
        description: 'Não foi possível carregar a lista de doramas.',
        variant: 'destructive',
      });
    } finally {
      setLoadingData(false);
    }
  };

  // Utility to create URL-friendly slugs
  const createSlug = (text) => {
    if (!text) return '';
    return text
      .toString()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^\w\-]+/g, '')
      .replace(/\-\-+/g, '-');
  };

  // ✅ iPhone/Stream: /play/ -> /embed/
  const normalizeStreamUrl = (url) => {
    if (!url) return '';
    let u = String(url).trim();
    u = u.replace('/play/', '/embed/');
    u = u.replace('mediadelivery.net/play/', 'mediadelivery.net/embed/');
    return u;
  };

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    const newValue = type === 'checkbox' ? checked : value;

    // ✅ Só normaliza o STREAM do iPhone. STORE fica intacto.
    if (name === 'bunny_stream_url') {
      setFormData((prev) => ({
        ...prev,
        bunny_stream_url: normalizeStreamUrl(value),
      }));
      return;
    }

    setFormData((prev) => ({
      ...prev,
      [name]: newValue,
    }));

    if (name === 'title') {
      const generated = createSlug(newValue);
      setEditingSlug(generated);
    }
  };

  const handleCoverFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setCoverFile(e.target.files[0]);
    }
  };

  const handleBannerFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setBannerFile(e.target.files[0]);
    }
  };

  const resetForm = () => {
    setFormData({
      title: '',
      description: '',
      release_year: '',
      genres: '',
      duration_minutes: '',
      cover_url: '',
      banner_url: '',
      bunny_url: '',
      bunny_stream_url: '',
      is_exclusive: false,
      is_new: false,
      is_featured: false,
      is_recommended: false,
      is_baby_pregnancy: false,
      is_taboo_relationship: false,
      is_hidden_identity: false,
      language: 'legendado',
    });
    setIsEditing(false);
    setEditingId(null);
    setEditingSlug('');
    setOriginalTitle('');
    setCoverFile(null);
    setBannerFile(null);

    if (fileInputRef.current) fileInputRef.current.value = '';
    if (bannerInputRef.current) bannerInputRef.current.value = '';
  };

  const uploadImage = async (file, bucket = 'covers') => {
    const fileExt = file.name.split('.').pop();
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
    const filePath = `covers/${fileName}`;

    const { error: uploadError } = await supabase.storage.from(bucket).upload(filePath, file);

    if (uploadError) throw uploadError;

    const { data: publicUrlData } = supabase.storage.from(bucket).getPublicUrl(filePath);

    return publicUrlData?.publicUrl;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    let finalCoverUrl = formData.cover_url;
    let finalBannerUrl = formData.banner_url;

    try {
      if (coverFile) {
        finalCoverUrl = await uploadImage(coverFile, 'covers');
      }

      if (bannerFile) {
        finalBannerUrl = await uploadImage(bannerFile, 'covers');
      }

      const basePayload = {
        title: formData.title,
        description: formData.description, // ✅ sinopse
        release_year: parseInt(formData.release_year) || new Date().getFullYear(),
        genres: formData.genres,
        duration_minutes: formData.duration_minutes, // ✅ duração (coluna certa)
        cover_url: finalCoverUrl,
        banner_url: finalBannerUrl,
        bunny_url: formData.bunny_url, // ✅ STORE
        bunny_stream_url: normalizeStreamUrl(formData.bunny_stream_url), // ✅ iPhone
        is_exclusive: formData.is_exclusive,
        is_new: formData.is_new,
        is_featured: formData.is_featured,
        is_recommended: formData.is_recommended,
        is_baby_pregnancy: formData.is_baby_pregnancy,
        is_taboo_relationship: formData.is_taboo_relationship,
        is_hidden_identity: formData.is_hidden_identity,
        language: formData.language,
      };

      if (isEditing) {
        const updatePayload = { ...basePayload };

        if (formData.title !== originalTitle) {
          updatePayload.slug = createSlug(formData.title);
        }

        const { error } = await supabase
          .from('doramas')
          .update(updatePayload)
          .eq('id', editingId);

        if (error) throw error;
        toast({ title: 'Sucesso', description: 'Dorama atualizado com sucesso.' });
      } else {
        const newSlug = createSlug(formData.title);

        const { data: existingSlug } = await supabase
          .from('doramas')
          .select('slug')
          .eq('slug', newSlug)
          .maybeSingle();

        if (existingSlug) {
          toast({
            title: 'Erro',
            description: 'Já existe um dorama com este título/slug.',
            variant: 'destructive',
          });
          return;
        }

        const createPayload = {
          ...basePayload,
          slug: newSlug,
        };

        const { error } = await supabase.from('doramas').insert([createPayload]);

        if (error) throw error;
        toast({ title: 'Sucesso', description: 'Dorama criado com sucesso.' });
      }

      resetForm();
      fetchDoramas();
    } catch (error) {
      console.error('Error saving dorama:', error);
      toast({
        title: 'Erro ao salvar',
        description: error.message || 'Ocorreu um erro ao salvar o dorama.',
        variant: 'destructive',
      });
    }
  };

  const handleEdit = (dorama) => {
    setFormData({
      title: dorama.title || '',
      description: dorama.description || '',
      release_year: dorama.release_year || '',
      genres: dorama.genres || '',
      duration_minutes: dorama.duration_minutes || '',
      cover_url: dorama.cover_url || '',
      banner_url: dorama.banner_url || '',
      bunny_url: dorama.bunny_url || '',
      bunny_stream_url: normalizeStreamUrl(dorama.bunny_stream_url || ''),
      is_exclusive: dorama.is_exclusive || false,
      is_new: dorama.is_new || false,
      is_featured: dorama.is_featured || false,
      is_recommended: dorama.is_recommended || false,
      is_baby_pregnancy: dorama.is_baby_pregnancy || false,
      is_taboo_relationship: dorama.is_taboo_relationship || false,
      is_hidden_identity: dorama.is_hidden_identity || false,
      language: dorama.language || 'legendado',
    });
    setEditingId(dorama.id);
    setOriginalTitle(dorama.title || '');
    setEditingSlug(dorama.slug || '');
    setIsEditing(true);
    setCoverFile(null);
    setBannerFile(null);

    if (fileInputRef.current) fileInputRef.current.value = '';
    if (bannerInputRef.current) bannerInputRef.current.value = '';

    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Tem certeza que deseja excluir este dorama? Esta ação não pode ser desfeita.')) return;

    try {
      const { error } = await supabase.from('doramas').delete().eq('id', id);

      if (error) throw error;

      toast({ title: 'Sucesso', description: 'Dorama excluído com sucesso.' });

      if (editingId === id) {
        resetForm();
      }

      fetchDoramas();
    } catch (error) {
      console.error('Error deleting dorama:', error);
      toast({
        title: 'Erro ao excluir',
        description: 'Não foi possível excluir o dorama.',
        variant: 'destructive',
      });
    }
  };

  const filteredDoramas = doramas;
  const totalPages = Math.max(1, Math.ceil((totalDoramas || 0) / PAGE_SIZE));

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-white">
        Carregando...
      </div>
    );
  }

  if (!isAuthorized) {
    return null;
  }

  return (
    <>
      <Helmet>
        <title>Painel Admin - DoramaStream</title>
      </Helmet>

      <div className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8 font-sans">
        <div className="max-w-7xl mx-auto">
          {/* Header + navegação topo */}
          <header className="mb-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h1 className="text-3xl font-bold text-purple-400 mb-1">
                  Painel de Doramas
                </h1>
                <p className="text-slate-400">Gerencie todos os doramas da plataforma.</p>
              </div>

              <Button
                type="button"
                variant="outline"
                onClick={() => navigate('/admin/analytics')}
                className="border-slate-700 text-slate-200 hover:bg-slate-800 hover:text-white flex items-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" />
                Voltar
              </Button>
            </div>

            {/* Abas do admin */}
            <AdminTopNav current="doramas" />
          </header>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Left Column: Form */}
            <div className="lg:col-span-4">
              <div className="bg-slate-900 p-6 rounded-xl border border-slate-800 sticky top-8">
                <h2 className="text-xl font-semibold mb-6 flex items-center gap-2">
                  {isEditing ? (
                    <Edit className="w-5 h-5 text-blue-400" />
                  ) : (
                    <Plus className="w-5 h-5 text-green-400" />
                  )}
                  {isEditing ? 'Editar Dorama' : 'Novo Dorama'}
                </h2>

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-1">
                      Título *
                    </label>
                    <input
                      required
                      name="title"
                      value={formData.title}
                      onChange={handleInputChange}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                      placeholder="Ex: Vincenzo"
                    />
                  </div>

                  {/* Slug Preview */}
                  <div>
                    <label className="block text-sm font-medium text-slate-500 mb-1">
                      Slug (Automático)
                    </label>
                    <input
                      disabled
                      value={editingSlug}
                      className="w-full bg-slate-950/50 border border-slate-800/50 rounded-lg px-4 py-2 text-slate-500 cursor-not-allowed font-mono text-sm"
                    />
                    {isEditing && formData.title !== originalTitle && (
                      <p className="text-[10px] text-amber-500/80 mt-1">
                        O slug será atualizado automaticamente pois o título foi alterado.
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-1">
                      Ano de Lançamento
                    </label>
                    <input
                      type="number"
                      name="release_year"
                      value={formData.release_year}
                      onChange={handleInputChange}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                      placeholder="Ex: 2021"
                    />
                  </div>

                  {/* ✅ DURAÇÃO (coluna certa) */}
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-1">
                      Duração (minutes) - coluna duration_minutes
                    </label>
                    <input
                      name="duration_minutes"
                      value={formData.duration_minutes}
                      onChange={handleInputChange}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-purple-500 font-mono text-sm"
                      placeholder="Ex: 45"
                    />
                  </div>

                  {/* GÊNEROS LIVRES */}
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-1">
                      Gêneros (texto livre)
                    </label>
                    <input
                      name="genres"
                      value={formData.genres}
                      onChange={handleInputChange}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                      placeholder="Ex: Ação, Crime, Romance"
                    />
                    <p className="text-[11px] text-slate-500 mt-1">
                      Isso aqui é só texto exibido na ficha. As categorias do catálogo são marcadas pelos campos abaixo.
                    </p>
                  </div>

                  {/* Flags & Language – NA MESMA ORDEM DO CATÁLOGO */}
                  <div className="space-y-3 pt-3 pb-3 border-y border-slate-800/50 my-2">
                    {/* 1. Destaque / Banner */}
                    <label className="flex items-center gap-2 cursor-pointer hover:text-amber-400 transition-colors">
                      <input
                        type="checkbox"
                        name="is_featured"
                        checked={formData.is_featured}
                        onChange={handleInputChange}
                        className="rounded border-slate-700 bg-slate-950 text-amber-500 focus:ring-amber-500"
                      />
                      <span className="text-sm text-slate-300 flex items-center gap-1">
                        <Star className="w-3 h-3" /> Destaque / Banner (aparece no topo)
                      </span>
                    </label>

                    {/* 2. Novo lançamento */}
                    <label className="flex items-center gap-2 cursor-pointer hover:text-green-400 transition-colors">
                      <input
                        type="checkbox"
                        name="is_new"
                        checked={formData.is_new}
                        onChange={handleInputChange}
                        className="rounded border-slate-700 bg-slate-950 text-green-500 focus:ring-green-500"
                      />
                      <span className="text-sm text-slate-300 flex items-center gap-1">
                        <BadgeCheck className="w-3 h-3" /> Novo lançamento
                      </span>
                    </label>

                    {/* 3. Séries dubladas */}
                    <label className="flex items-center gap-2 cursor-pointer hover:text-blue-400 transition-colors">
                      <input
                        type="checkbox"
                        checked={formData.language === 'dublado'}
                        onChange={(e) => {
                          setFormData((prev) => ({
                            ...prev,
                            language: e.target.checked ? 'dublado' : 'legendado',
                          }));
                        }}
                        className="rounded border-slate-700 bg-slate-950 text-blue-500 focus:ring-blue-500"
                      />
                      <span className="text-sm text-slate-300 flex items-center gap-1">
                        <Globe className="w-3 h-3" /> Série dublada
                      </span>
                    </label>

                    {/* 4. Bebês e gravidezes */}
                    <label className="flex items-center gap-2 cursor-pointer hover:text-pink-400 transition-colors">
                      <input
                        type="checkbox"
                        name="is_baby_pregnancy"
                        checked={formData.is_baby_pregnancy}
                        onChange={handleInputChange}
                        className="rounded border-slate-700 bg-slate-950 text-pink-500 focus:ring-pink-500"
                      />
                      <span className="text-sm text-slate-300 flex items-center gap-1">
                        <Baby className="w-3 h-3" /> Bebês e gravidezes
                      </span>
                    </label>

                    {/* 5. Relacionamento tabu */}
                    <label className="flex items-center gap-2 cursor-pointer hover:text-red-400 transition-colors">
                      <input
                        type="checkbox"
                        name="is_taboo_relationship"
                        checked={formData.is_taboo_relationship}
                        onChange={handleInputChange}
                        className="rounded border-slate-700 bg-slate-950 text-red-500 focus:ring-red-500"
                      />
                      <span className="text-sm text-slate-300 flex items-center gap-1">
                        <HeartHandshake className="w-3 h-3" /> Relacionamento tabu
                      </span>
                    </label>

                    {/* 6. Identidade escondida */}
                    <label className="flex items-center gap-2 cursor-pointer hover:text-teal-400 transition-colors">
                      <input
                        type="checkbox"
                        name="is_hidden_identity"
                        checked={formData.is_hidden_identity}
                        onChange={handleInputChange}
                        className="rounded border-slate-700 bg-slate-950 text-teal-500 focus:ring-teal-500"
                      />
                      <span className="text-sm text-slate-300 flex items-center gap-1">
                        <Eye className="w-3 h-3" /> Identidade escondida
                      </span>
                    </label>

                    {/* 7. Recomendados para você */}
                    <label className="flex items-center gap-2 cursor-pointer hover:text-purple-400 transition-colors">
                      <input
                        type="checkbox"
                        name="is_recommended"
                        checked={formData.is_recommended}
                        onChange={handleInputChange}
                        className="rounded border-slate-700 bg-slate-950 text-purple-500 focus:ring-purple-500"
                      />
                      <span className="text-sm text-slate-300 flex items-center gap-1">
                        <Sparkles className="w-3 h-3" /> Recomendado para você
                      </span>
                    </label>

                    {/* Extra: Exclusivo (selo opcional) */}
                    <label className="flex items-center gap-2 cursor-pointer hover:text-fuchsia-400 transition-colors">
                      <input
                        type="checkbox"
                        name="is_exclusive"
                        checked={formData.is_exclusive}
                        onChange={handleInputChange}
                        className="rounded border-slate-700 bg-slate-950 text-fuchsia-500 focus:ring-fuchsia-500"
                      />
                      <span className="text-sm text-slate-300 flex items-center gap-1">
                        <Sparkles className="w-3 h-3" /> Exclusivo (selo opcional)
                      </span>
                    </label>
                  </div>

                  {/* Cover Upload */}
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-1">
                      Capa (Imagem Vertical)
                    </label>

                    {formData.cover_url && (
                      <div className="mb-2 relative w-24 h-36 bg-slate-950 rounded-md overflow-hidden border border-slate-800 shadow-sm group">
                        <img
                          src={formData.cover_url}
                          alt="Capa atual"
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-[10px] text-center py-1 text-white">
                          Atual
                        </div>
                      </div>
                    )}

                    <div className="relative">
                      <input
                        type="file"
                        accept="image/*"
                        ref={fileInputRef}
                        onChange={handleCoverFileChange}
                        className="w-full text-sm text-slate-400
                          file:mr-4 file:py-2 file:px-4
                          file:rounded-md file:border-0
                          file:text-xs file:font-semibold
                          file:bg-purple-900/50 file:text-purple-300
                          hover:file:bg-purple-900/70
                          bg-slate-950 rounded-lg border border-slate-800
                          cursor-pointer"
                      />
                    </div>
                  </div>

                  {/* Banner Upload (Opcional) */}
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-1">
                      Banner Horizontal (Opcional)
                    </label>

                    {formData.banner_url && (
                      <div className="mb-2 relative w-full h-24 bg-slate-950 rounded-md overflow-hidden border border-slate-800 shadow-sm group">
                        <img
                          src={formData.banner_url}
                          alt="Banner atual"
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-[10px] text-center py-1 text-white">
                          Atual
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setFormData((prev) => ({ ...prev, banner_url: '' }))
                          }
                          className="absolute top-1 right-1 bg-black/60 rounded-full p-1 text-white hover:bg-red-600 transition-colors"
                          title="Remover banner"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    )}

                    <div className="relative">
                      <input
                        type="file"
                        accept="image/*"
                        ref={bannerInputRef}
                        onChange={handleBannerFileChange}
                        className="w-full text-sm text-slate-400
                          file:mr-4 file:py-2 file:px-4
                          file:rounded-md file:border-0
                          file:text-xs file:font-semibold
                          file:bg-blue-900/50 file:text-blue-300
                          hover:file:bg-blue-900/70
                          bg-slate-950 rounded-lg border border-slate-800
                          cursor-pointer"
                      />
                    </div>
                  </div>

                  {/* ✅ STORE */}
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-1">
                      Bunny URL (STORE)
                    </label>
                    <input
                      name="bunny_url"
                      value={formData.bunny_url}
                      onChange={handleInputChange}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-purple-500 font-mono text-xs"
                      placeholder="https://sua-pullzone.b-cdn.net/video.mp4"
                    />
                  </div>

                  {/* ✅ IPHONE */}
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-1">
                      Bunny Stream URL (iPhone)
                    </label>
                    <input
                      name="bunny_stream_url"
                      value={formData.bunny_stream_url}
                      onChange={handleInputChange}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-purple-500 font-mono text-xs"
                      placeholder="Cole /play/ que vira /embed/ sozinho"
                    />
                    <p className="text-[11px] text-slate-500 mt-1">
                      Se vier com <b>/play/</b>, eu converto para <b>/embed/</b> automaticamente.
                    </p>
                  </div>

                  {/* ✅ SINOPSE */}
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-1">
                      Sinopse
                    </label>
                    <textarea
                      name="description"
                      value={formData.description}
                      onChange={handleInputChange}
                      rows={4}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"
                      placeholder="Sinopse do dorama..."
                    />
                  </div>

                  <div className="pt-4 flex flex-col gap-3">
                    <div className="flex gap-3">
                      <Button
                        type="submit"
                        className={`flex-1 ${
                          isEditing
                            ? 'bg-blue-600 hover:bg-blue-700'
                            : 'bg-green-600 hover:bg-green-700'
                        } text-white`}
                      >
                        {isEditing ? (
                          <>
                            <Save className="w-4 h-4 mr-2" /> Salvar Alterações
                          </>
                        ) : (
                          <>
                            <Plus className="w-4 h-4 mr-2" /> Criar Dorama
                          </>
                        )}
                      </Button>

                      {isEditing && (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={resetForm}
                          className="border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      )}
                    </div>

                    {isEditing && (
                      <Button
                        type="button"
                        variant="destructive"
                        onClick={() => handleDelete(editingId)}
                        className="w-full bg-red-900/30 hover:bg-red-900/50 text-red-400 border border-red-900/50"
                      >
                        <Trash2 className="w-4 h-4 mr-2" /> Excluir Dorama
                      </Button>
                    )}
                  </div>
                </form>
              </div>
            </div>

            {/* Right Column: List */}
            <div className="lg:col-span-8">
              <div className="bg-slate-900 p-6 rounded-xl border border-slate-800 h-full flex flex-col">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
                  <h2 className="text-xl font-semibold">
                    Catálogo ({totalDoramas})
                  </h2>

                  <div className="relative w-full sm:w-64">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Buscar por título..."
                      className="w-full bg-slate-950 border border-slate-800 rounded-full pl-10 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                  </div>
                </div>

                {/* Filter Tabs */}
                <div className="flex flex-wrap gap-2 mb-6">
                  {filterTabs.map((tab) => {
                    const TabIcon = tab.icon;
                    return (
                      <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={cn(
                          'px-3 py-1.5 rounded-full text-xs font-medium transition-colors flex items-center gap-1.5 border',
                          activeTab === tab.id
                            ? 'bg-purple-600 text-white border-purple-500'
                            : 'bg-slate-950 text-slate-400 border-slate-800 hover:bg-slate-800 hover:text-slate-200'
                        )}
                      >
                        <TabIcon className="w-3.5 h-3.5" />
                        {tab.label}
                      </button>
                    );
                  })}
                </div>

                {loadingData ? (
                  <div className="text-center py-12 text-slate-500 animate-pulse">
                    Carregando lista...
                  </div>
                ) : filteredDoramas.length === 0 ? (
                  <div className="text-center py-12 text-slate-500">
                    Nenhum dorama encontrado.
                  </div>
                ) : (
                  <>
                    <div className="grid gap-4">
                      {filteredDoramas.map((dorama) => (
                        <div
                          key={dorama.id}
                          onClick={() => handleEdit(dorama)}
                          className={`group flex flex-col sm:flex-row items-start sm:items-center gap-4 bg-slate-950 p-4 rounded-lg border cursor-pointer transition-all
                            ${
                              editingId === dorama.id
                                ? 'border-blue-500 ring-1 ring-blue-500/30 bg-slate-900'
                                : 'border-slate-800 hover:border-slate-700 hover:bg-slate-900/50'
                            }
                          `}
                        >
                          {/* Thumbnail */}
                          <div className="w-full sm:w-16 h-24 sm:h-20 bg-slate-900 rounded-md overflow-hidden flex-shrink-0 border border-slate-800 relative">
                            {dorama.cover_url ? (
                              <img
                                src={dorama.cover_url}
                                alt={dorama.title}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-xs text-slate-600 bg-slate-900">
                                <ImageIcon className="w-6 h-6 text-slate-700" />
                              </div>
                            )}
                          </div>

                          {/* Info */}
                          <div className="flex-1 min-w-0 space-y-2">
                            <div className="flex items-start justify-between">
                              <div>
                                <h3
                                  className={`font-bold truncate ${
                                    editingId === dorama.id ? 'text-blue-400' : 'text-slate-200'
                                  }`}
                                >
                                  {dorama.title}
                                </h3>

                                {/* ✅ Aqui volta ano + gênero + duração */}
                                <p className="text-sm text-slate-500 truncate">
                                  {dorama.release_year || 'Ano N/A'} • {dorama.genres || 'Sem Gênero'}
                                  {dorama.duration_minutes ? ` • ${dorama.duration_minutes} min` : ''}
                                </p>
                              </div>

                              {/* Banner Icon Indicator */}
                              {dorama.banner_url && (
                                <div title="Possui Banner" className="text-blue-500">
                                  <MonitorPlay className="w-4 h-4" />
                                </div>
                              )}
                            </div>

                            {/* Badges Row */}
                            <div className="flex flex-wrap gap-2">
                              {dorama.is_exclusive && (
                                <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-fuchsia-500/10 text-fuchsia-400 border border-fuchsia-500/20 rounded flex items-center gap-1">
                                  <Sparkles className="w-3 h-3" /> Exclusivo
                                </span>
                              )}
                              {dorama.is_featured && (
                                <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded flex items-center gap-1">
                                  <Star className="w-3 h-3" /> Destaque
                                </span>
                              )}
                              {dorama.is_new && (
                                <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-green-500/10 text-green-400 border border-green-500/20 rounded flex items-center gap-1">
                                  <BadgeCheck className="w-3 h-3" /> Novo
                                </span>
                              )}
                              {dorama.language === 'dublado' ? (
                                <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded flex items-center gap-1">
                                  <Globe className="w-3 h-3" /> Dublado
                                </span>
                              ) : (
                                <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-slate-700/30 text-slate-400 border border-slate-700/50 rounded">
                                  Legendado
                                </span>
                              )}

                              {dorama.is_baby_pregnancy && (
                                <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-pink-500/10 text-pink-300 border border-pink-500/20 rounded flex items-center gap-1">
                                  <Baby className="w-3 h-3" /> Bebês / Gravidez
                                </span>
                              )}
                              {dorama.is_taboo_relationship && (
                                <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-red-500/10 text-red-300 border border-red-500/20 rounded flex items-center gap-1">
                                  <HeartHandshake className="w-3 h-3" /> Tabu
                                </span>
                              )}
                              {dorama.is_hidden_identity && (
                                <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-teal-500/10 text-teal-300 border border-teal-500/20 rounded flex items-center gap-1">
                                  <Eye className="w-3 h-3" /> Identidade escondida
                                </span>
                              )}
                              {dorama.is_recommended && (
                                <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-purple-500/10 text-purple-300 border border-purple-500/20 rounded flex items-center gap-1">
                                  <Sparkles className="w-3 h-3" /> Recomendado
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Indicator */}
                          <div className="hidden sm:block">
                            {editingId === dorama.id ? (
                              <div className="text-xs bg-blue-900/30 text-blue-400 px-2 py-1 rounded border border-blue-800/50">
                                Editando
                              </div>
                            ) : (
                              <Edit className="w-4 h-4 text-slate-600 opacity-0 group-hover:opacity-100" />
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* ✅ Paginação */}
                    {totalPages > 1 && (
                      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                          className="px-3 py-1.5 rounded-md border border-slate-800 bg-slate-950 text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                          disabled={currentPage === 1}
                        >
                          Anterior
                        </button>

                        {Array.from({ length: totalPages }).slice(0, 30).map((_, idx) => {
                          const page = idx + 1;
                          const active = page === currentPage;
                          return (
                            <button
                              key={page}
                              type="button"
                              onClick={() => setCurrentPage(page)}
                              className={
                                'px-3 py-1.5 rounded-md border text-sm ' +
                                (active
                                  ? 'bg-purple-600 text-white border-purple-500'
                                  : 'bg-slate-950 text-slate-300 border-slate-800 hover:bg-slate-800')
                              }
                            >
                              {page}
                            </button>
                          );
                        })}

                        <button
                          type="button"
                          onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                          className="px-3 py-1.5 rounded-md border border-slate-800 bg-slate-950 text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                          disabled={currentPage === totalPages}
                        >
                          Próxima
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}